package com.nexusflow.core;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.*;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import static com.nexusflow.core.AuthController.status;

@RestController
class WorkflowEmailController {
    record Notification(@NotNull UUID id,@NotNull UUID orgId,@NotNull UUID userId,
        @NotBlank @Size(max=500) String title,@Size(max=100) String href) {}

    private final JdbcTemplate db;
    private final JavaMailSender mail;
    private final byte[] secret;
    private final String origin, sender;

    WorkflowEmailController(JdbcTemplate db,JavaMailSender mail,@Value("${nexus.worker-secret}") String secret,
        @Value("${nexus.origin}") String origin,@Value("${nexus.mail-from}") String sender) {
        this.db=db;this.mail=mail;this.secret=secret.getBytes(StandardCharsets.UTF_8);this.origin=origin;this.sender=sender;
    }

    @PostMapping("/internal/workflow-email")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    void send(@RequestHeader(value="X-Worker-Secret",defaultValue="") String key,@Valid @RequestBody Notification input) {
        if (secret.length<32 || !MessageDigest.isEqual(secret,key.getBytes(StandardCharsets.UTF_8)))
            throw status(HttpStatus.UNAUTHORIZED,"Invalid worker credentials.");
        var recipients=db.query("""
            SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id
            JOIN workflow_executions e ON e.org_id=m.org_id
            WHERE m.org_id=? AND m.user_id=? AND e.id=? AND u.verified AND NOT u.suspended
            """,(row,i)->row.getString(1),input.orgId(),input.userId(),input.id());
        if (recipients.isEmpty() || db.update("INSERT INTO notification_emails(id) VALUES (?) ON CONFLICT DO NOTHING",input.id())==0) return;
        SimpleMailMessage message=new SimpleMailMessage();
        message.setFrom(sender);message.setTo(recipients.getFirst());message.setSubject("NexusFlow workspace update");
        String href=input.href()!=null&&input.href().matches("/projects/[a-fA-F0-9-]{36}")?input.href():"/notifications";
        message.setText(input.title()+"\n\n"+origin+href);
        try {mail.send(message);}
        catch (MailException error) {throw status(HttpStatus.SERVICE_UNAVAILABLE,"Notification mail delivery is temporarily unavailable.");}
    }
}
