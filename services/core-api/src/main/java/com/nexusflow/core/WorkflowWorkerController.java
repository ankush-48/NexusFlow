package com.nexusflow.core;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import static com.nexusflow.core.AuthController.status;

@RestController
class WorkflowWorkerController {
    record WorkerEvent(@NotNull UUID id,@NotNull UUID orgId,@NotBlank @Size(max=80) String type,
        @NotNull Map<String,Object> payload,boolean delivered) {}
    private final JdbcTemplate db;
    private final byte[] secret;

    WorkflowWorkerController(JdbcTemplate db,@Value("${nexus.worker-secret}") String secret) {
        this.db=db;this.secret=secret.getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/internal/events")
    @Transactional
    List<Map<String,Object>> match(@RequestHeader(value="X-Worker-Secret",defaultValue="") String key,@Valid @RequestBody WorkerEvent event) {
        if (secret.length<32 || !MessageDigest.isEqual(secret,key.getBytes(StandardCharsets.UTF_8))) throw status(HttpStatus.UNAUTHORIZED,"Invalid worker credentials.");
        if (event.delivered()) {
            db.update("UPDATE workflow_executions SET status='Succeeded' WHERE org_id=? AND event_id=?",event.orgId(),event.id());
            return List.of();
        }
        var target=event.payload().get("recipientId");
        if (!(target instanceof String recipient)) return List.of();
        UUID user;
        try {user=UUID.fromString(recipient);} catch (IllegalArgumentException error) {return List.of();}
        if (!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM memberships WHERE org_id=? AND user_id=?)",Boolean.class,event.orgId(),user))) return List.of();
        Object priority=event.payload().getOrDefault("priority","Any");
        db.update("""
            INSERT INTO workflow_executions(org_id,rule_id,event_id,status)
            SELECT org_id,id,?,'Queued' FROM workflow_rules WHERE org_id=? AND trigger=? AND active AND (priority='Any' OR priority=?)
            ON CONFLICT(rule_id,event_id) DO NOTHING
            """,event.id(),event.orgId(),event.type(),priority);
        return db.queryForList("""
            SELECT e.id, r.message AS title, ?::uuid AS "userId"
            FROM workflow_executions e JOIN workflow_rules r ON r.org_id=e.org_id AND r.id=e.rule_id
            WHERE e.org_id=? AND e.event_id=?
            """,user,event.orgId(),event.id());
    }
}
