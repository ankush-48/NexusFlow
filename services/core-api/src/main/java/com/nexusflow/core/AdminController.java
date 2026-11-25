package com.nexusflow.core;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import static com.nexusflow.core.AuthController.status;

@RestController
@RequestMapping("/api/admin")
class AdminController {
    record Suspension(boolean suspended) {}
    private final JdbcTemplate db;
    AdminController(JdbcTemplate db) {this.db=db;}

    @GetMapping
    Map<String,Object> overview(@AuthenticationPrincipal Sessions.User admin) {
        require(admin);
        return Map.of("organizations",db.queryForList("SELECT id,name,plan FROM organizations ORDER BY name LIMIT 200"),
            "users",db.queryForList("SELECT id,name,email,suspended FROM users ORDER BY name LIMIT 200"),
            "health",db.queryForMap("SELECT count(*) FILTER (WHERE published_at IS NULL) AS pending, count(*) AS total FROM outbox"));
    }

    @PatchMapping("/users/{id}")
    @Transactional
    Map<String,Object> suspend(@AuthenticationPrincipal Sessions.User admin,@PathVariable UUID id,@RequestBody Suspension body) {
        require(admin);
        if (db.update("UPDATE users SET suspended=? WHERE id=? AND NOT platform_admin",body.suspended(),id)==0)
            throw status(HttpStatus.FORBIDDEN,"This account cannot be suspended.");
        if (body.suspended()) db.update("DELETE FROM sessions WHERE user_id=?",id);
        return Map.of("id",id,"suspended",body.suspended());
    }

    private void require(Sessions.User user) {
        if (!user.platformAdmin()) throw status(HttpStatus.FORBIDDEN,"Platform administrator access is required.");
    }
}
