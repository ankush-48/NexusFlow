package com.nexusflow.core;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.*;

@Service
class Events {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final KafkaTemplate<String,String> kafka;
    private final boolean enabled;
    private static final Logger LOG=LoggerFactory.getLogger(Events.class);

    Events(JdbcTemplate db,ObjectMapper json,KafkaTemplate<String,String> kafka,@Value("${nexus.outbox-enabled}") boolean enabled) {
        this.db=db;this.json=json;this.kafka=kafka;this.enabled=enabled;
    }

    void add(UUID org,String type,Map<String,?> payload) {
        String correlation = Optional.ofNullable(RequestContextHolder.getRequestAttributes())
            .filter(ServletRequestAttributes.class::isInstance).map(ServletRequestAttributes.class::cast).map(ServletRequestAttributes::getRequest)
            .map(request->request.getHeader("X-Correlation-ID")).filter(value->value.matches("[a-zA-Z0-9-]{1,64}")).orElseGet(()->UUID.randomUUID().toString());
        try {
            db.update("INSERT INTO outbox(org_id,type,correlation_id,payload) VALUES (?,?,?,CAST(? AS jsonb))",org,type,correlation,json.writeValueAsString(payload));
        } catch (JacksonException error) {throw new IllegalArgumentException("Event payload could not be encoded",error);}
    }

    @Scheduled(fixedDelayString="${NEXUS_OUTBOX_INTERVAL_MS:2000}")
    @Transactional
    public void publish() {
        if (!enabled) return;
        var batch=db.queryForList("""
            SELECT id,org_id,type,correlation_id,payload::text AS payload,created_at
            FROM outbox WHERE published_at IS NULL ORDER BY created_at,id LIMIT 25 FOR UPDATE SKIP LOCKED
            """);
        for (var event:batch) {
            try {
                var body=json.createObjectNode().put("version",1).put("id",event.get("id").toString())
                    .put("orgId",event.get("org_id").toString()).put("type",event.get("type").toString())
                    .put("correlationId",event.get("correlation_id").toString()).put("occurredAt",event.get("created_at").toString());
                body.set("payload",json.readTree(event.get("payload").toString()));
                kafka.send("nexusflow.domain.v1",event.get("org_id").toString(),json.writeValueAsString(body)).get(11,TimeUnit.SECONDS);
                db.update("UPDATE outbox SET published_at=now() WHERE id=?",event.get("id"));
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception error) {
                LOG.warn("Outbox publish delayed for event {} (correlation {})",event.get("id"),event.get("correlation_id"),error);
                break;
            }
        }
    }

    @Scheduled(fixedDelayString="${NEXUS_OVERDUE_INTERVAL_MS:60000}",initialDelay=15000)
    @Transactional
    public void findOverdue() {
        if (!enabled) return;
        var dueSoon=db.queryForList("""
            SELECT id,org_id,project_id,assignee,priority,title FROM tasks
            WHERE status<>'Completed' AND due_date BETWEEN current_date AND current_date+2 AND assignee IS NOT NULL AND reminder_event_date IS NULL
            ORDER BY due_date,id LIMIT 100 FOR UPDATE SKIP LOCKED
            """);
        for (var task:dueSoon) {
            add((UUID)task.get("org_id"),"task.due_soon",Map.of("taskId",task.get("id"),"projectId",task.get("project_id"),
                "recipientId",task.get("assignee"),"priority",task.get("priority"),"title",task.get("title")));
            db.update("UPDATE tasks SET reminder_event_date=current_date WHERE id=?",task.get("id"));
        }
        var overdue=db.queryForList("""
            SELECT id,org_id,project_id,assignee,priority,title FROM tasks
            WHERE status<>'Completed' AND due_date<current_date AND assignee IS NOT NULL AND overdue_event_date IS NULL
            ORDER BY due_date,id LIMIT 100 FOR UPDATE SKIP LOCKED
            """);
        for (var task:overdue) {
            add((UUID)task.get("org_id"),"task.overdue",Map.of("taskId",task.get("id"),"projectId",task.get("project_id"),
                "recipientId",task.get("assignee"),"priority",task.get("priority"),"title",task.get("title")));
            db.update("UPDATE tasks SET overdue_event_date=current_date WHERE id=?",task.get("id"));
        }
    }
}
