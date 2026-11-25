package com.nexusflow.core;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class Sessions {
    record User(UUID id, String name, String email, boolean platformAdmin) {}
    record Tokens(String access, String refresh) {}
    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcTemplate db;
    private final boolean secure;

    Sessions(JdbcTemplate db, @Value("${nexus.secure-cookies}") boolean secure) {
        this.db = db;
        this.secure = secure;
    }

    static String token() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    Optional<User> resolve(String access) {
        if (access.isBlank()) return Optional.empty();
        return db.query("""
            SELECT u.id,u.name,u.email,u.platform_admin FROM sessions s JOIN users u ON u.id=s.user_id
            WHERE s.access_hash=? AND s.access_expires>now() AND s.refresh_expires>now() AND NOT u.suspended
            """, (row,i)->new User(row.getObject("id",UUID.class),row.getString("name"),row.getString("email"),row.getBoolean("platform_admin")),hash(access)).stream().findFirst();
    }

    Tokens issue(UUID userId) {
        var tokens = new Tokens(token(),token());
        db.update("""
            INSERT INTO sessions(user_id,access_hash,refresh_hash,access_expires,refresh_expires)
            VALUES (?,?,?,now()+interval '15 minutes',now()+interval '14 days')
            """,userId,hash(tokens.access),hash(tokens.refresh));
        return tokens;
    }

    @Transactional
    Optional<Tokens> issueAfterLogin(UUID userId, String checkedPasswordHash) {
        // Reset and suspension take an exclusive lock on this same row before clearing sessions.
        var eligible = db.query("""
            SELECT id FROM users WHERE id=? AND password_hash=? AND verified AND NOT suspended FOR SHARE
            """, (row,i)->row.getObject(1,UUID.class), userId, checkedPasswordHash);
        return eligible.stream().findFirst().map(this::issue);
    }

    @Transactional
    Optional<Tokens> rotate(String refresh) {
        if (refresh.isBlank()) return Optional.empty();
        var tokens = new Tokens(token(),token());
        return db.query("""
            UPDATE sessions s SET access_hash=?,refresh_hash=?,access_expires=least(now()+interval '15 minutes',s.refresh_expires)
            FROM users u WHERE u.id=s.user_id AND NOT u.suspended AND s.refresh_hash=? AND s.refresh_expires>now()
            RETURNING s.id
            """,(row,i)->tokens,hash(tokens.access),hash(tokens.refresh),hash(refresh)).stream().findFirst();
    }

    void revoke(String access, String refresh) {
        db.update("DELETE FROM sessions WHERE access_hash=? OR refresh_hash=?",hash(access),hash(refresh));
    }

    HttpHeaders cookieHeaders(Tokens tokens) {
        var headers = new HttpHeaders();
        headers.setCacheControl("no-store");
        headers.add(HttpHeaders.SET_COOKIE, cookie("nf_access",tokens == null ? "" : tokens.access,"/",tokens == null ? 0 : 900));
        headers.add(HttpHeaders.SET_COOKIE, cookie("nf_refresh",tokens == null ? "" : tokens.refresh,"/api/auth",tokens == null ? 0 : 14*86400));
        return headers;
    }

    private String cookie(String name, String value, String path, int maxAge) {
        return ResponseCookie.from(name,value).httpOnly(true).secure(secure).sameSite("Lax").path(path).maxAge(maxAge).build().toString();
    }
}
