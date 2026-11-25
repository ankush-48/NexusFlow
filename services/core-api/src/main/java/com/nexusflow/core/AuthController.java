package com.nexusflow.core;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
class AuthController {
    record Registration(@NotBlank @Size(max=100) String name, @NotBlank @jakarta.validation.constraints.Email @Size(max=254) String email, @NotBlank @Size(min=12,max=72) String password) {}
    record Login(@NotBlank @jakarta.validation.constraints.Email @Size(max=254) String email,@NotBlank @Size(max=72) String password) {}
    record Email(@NotBlank @jakarta.validation.constraints.Email @Size(max=254) String email) {}
    record Verify(@NotBlank @Size(max=100) String token) {}
    record Reset(@NotBlank @Size(max=100) String token,@NotBlank @Size(min=12,max=72) String password) {}
    record Profile(@NotBlank @Size(max=100) String name) {}
    private final JdbcTemplate db;
    private final BCryptPasswordEncoder encoder;
    private final Sessions sessions;
    private final JavaMailSender mail;
    private final String origin;
    private final String sender;
    private final boolean verifyEmail;
    private final String dummy;

    AuthController(JdbcTemplate db, BCryptPasswordEncoder encoder, Sessions sessions, JavaMailSender mail,
            @Value("${nexus.origin}") String origin,@Value("${nexus.mail-from}") String sender,@Value("${nexus.verify-email}") boolean verifyEmail) {
        this.db=db; this.encoder=encoder; this.sessions=sessions; this.mail=mail; this.origin=origin; this.sender=sender; this.verifyEmail=verifyEmail;
        this.dummy=encoder.encode(Sessions.token());
    }

    @PostMapping("/register")
    ResponseEntity<?> register(@Valid @RequestBody Registration form) {
        byteLimit(form.password());
        String email = normalize(form.email());
        var ids = db.query("""
            INSERT INTO users(email,name,password_hash,verified) VALUES (?,?,?,?)
            ON CONFLICT (email) DO NOTHING RETURNING id
            """,(row,i)->row.getObject(1,UUID.class),email,form.name().strip(),encoder.encode(form.password()),!verifyEmail);
        if (ids.isEmpty()) throw status(HttpStatus.CONFLICT,"An account already exists for this email.");
        if (verifyEmail) {
            send(ids.getFirst(),email,"verify");
            return ResponseEntity.status(201).body(Map.of("verificationRequired",true));
        }
        return ResponseEntity.status(201).headers(sessions.cookieHeaders(sessions.issue(ids.getFirst()))).body(Map.of("verificationRequired",false));
    }

    @PostMapping("/login")
    ResponseEntity<?> login(@Valid @RequestBody Login form) {
        byteLimit(form.password());
        var rows = db.queryForList("SELECT id,password_hash,verified,suspended FROM users WHERE email=?",normalize(form.email()));
        var user = rows.stream().findFirst();
        boolean match = encoder.matches(form.password(),user.map(row->(String) row.get("password_hash")).orElse(dummy));
        if (!match || user.isEmpty() || Boolean.TRUE.equals(user.get().get("suspended"))) throw status(HttpStatus.UNAUTHORIZED,"Email or password is incorrect.");
        if (!Boolean.TRUE.equals(user.get().get("verified"))) throw status(HttpStatus.FORBIDDEN,"Verify your email before signing in.");
        var tokens=sessions.issueAfterLogin((UUID)user.get().get("id"),(String)user.get().get("password_hash"))
            .orElseThrow(()->status(HttpStatus.UNAUTHORIZED,"Email or password is incorrect."));
        return ResponseEntity.ok().headers(sessions.cookieHeaders(tokens)).body(Map.of("signedIn",true));
    }

    @PostMapping("/refresh")
    ResponseEntity<Void> refresh(HttpServletRequest request) {
        return sessions.rotate(Security.cookie(request,"nf_refresh"))
            .map(tokens -> ResponseEntity.noContent().headers(sessions.cookieHeaders(tokens)).<Void>build())
            .orElseGet(() -> ResponseEntity.status(401).build());
    }

    @PostMapping("/logout")
    ResponseEntity<Void> logout(HttpServletRequest request) {
        sessions.revoke(Security.cookie(request,"nf_access"),Security.cookie(request,"nf_refresh"));
        return ResponseEntity.noContent().headers(sessions.cookieHeaders(null)).build();
    }

    @GetMapping("/me")
    Sessions.User me(@AuthenticationPrincipal Sessions.User user) {
        return user;
    }

    @PatchMapping("/profile")
    Sessions.User profile(@AuthenticationPrincipal Sessions.User user, @Valid @RequestBody Profile form) {
        String name=form.name().strip();
        db.update("UPDATE users SET name=? WHERE id=?",name,user.id());
        return new Sessions.User(user.id(),name,user.email(),user.platformAdmin());
    }

    @GetMapping("/sessions")
    List<Map<String,Object>> listSessions(@AuthenticationPrincipal Sessions.User user,HttpServletRequest request) {
        return db.queryForList("""
            SELECT id,created_at AS "createdAt", refresh_expires AS "expiresAt", access_hash=? AS current FROM sessions
            WHERE user_id=? AND refresh_expires>now() ORDER BY created_at DESC LIMIT 50
            """,Sessions.hash(Security.cookie(request,"nf_access")),user.id());
    }

    @DeleteMapping("/sessions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void remove(@AuthenticationPrincipal Sessions.User user,@PathVariable UUID id) {
        db.update("DELETE FROM sessions WHERE id=? AND user_id=?",id,user.id());
    }

    @PostMapping("/forgot-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void forgot(@Valid @RequestBody Email form) {
        deliver(form.email(),"reset");
    }

    @PostMapping("/resend-verification")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void resend(@Valid @RequestBody Email form) {
        deliver(form.email(),"verify");
    }

    @PostMapping("/verify")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    void verify(@Valid @RequestBody Verify form) {
        UUID userId = consume(form.token(),"verify");
        db.update("UPDATE users SET verified=true WHERE id=?",userId);
    }

    @PostMapping("/reset-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    void reset(@Valid @RequestBody Reset form) {
        byteLimit(form.password());
        UUID userId=consume(form.token(),"reset");
        db.update("UPDATE users SET password_hash=? WHERE id=?",encoder.encode(form.password()),userId);
        db.update("DELETE FROM sessions WHERE user_id=?",userId);
        db.update("DELETE FROM auth_tokens WHERE user_id=? AND purpose='reset'",userId);
    }

    private UUID consume(String token,String purpose) {
        return db.query("DELETE FROM auth_tokens WHERE token_hash=? AND purpose=? AND expires_at>now() RETURNING user_id",
            (row,i)->row.getObject(1,UUID.class),Sessions.hash(token),purpose).stream().findFirst()
            .orElseThrow(()->status(HttpStatus.BAD_REQUEST,"This link is invalid or expired."));
    }

    private void deliver(String address,String purpose) {
        String email=normalize(address);
        db.query("SELECT id FROM users WHERE email=? AND NOT suspended AND (verified=false OR ?='reset')",
            (row,i)->row.getObject(1,UUID.class),email,purpose).stream().findFirst().ifPresent(id->send(id,email,purpose));
    }

    private void send(UUID userId,String email,String purpose) {
        String token=Sessions.token();
        db.update("INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES (?,?,?,now()+interval '1 hour')",Sessions.hash(token),userId,purpose);
        SimpleMailMessage message=new SimpleMailMessage();
        message.setFrom(sender); message.setTo(email);
        message.setSubject(purpose.equals("verify")?"Verify your NexusFlow email":"Reset your NexusFlow password");
        message.setText(origin+(purpose.equals("verify")?"/login?verify=":"/forgot-password?reset=")+token);
        try {mail.send(message);} catch (org.springframework.mail.MailException error) {
            LoggerFactory.getLogger(AuthController.class).warn("Auth mail delivery failed for the {} flow", purpose);
        }
    }

    static String normalize(String email) { return email.strip().toLowerCase(Locale.ROOT); }
    static void byteLimit(String password) {
        if (password.getBytes(StandardCharsets.UTF_8).length>72) throw status(HttpStatus.BAD_REQUEST,"Password exceeds 72 UTF-8 bytes.");
    }
    static ResponseStatusException status(HttpStatus code,String message) {return new ResponseStatusException(code,message);}
}
