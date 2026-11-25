package com.nexusflow.core;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orgs/{org}/directory")
class DirectoryController {
    record Entry(@NotBlank @Size(max=80) String name,UUID departmentId) {}
    record Membership(@NotNull UUID userId,boolean assigned) {}
    private final JdbcTemplate db;
    private final Tenants tenants;

    DirectoryController(JdbcTemplate db,Tenants tenants) {this.db=db;this.tenants=tenants;}

    @GetMapping
    Map<String,Object> list(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user) {
        tenants.require(org,user);
        return Map.of("departments",db.queryForList("SELECT id,name FROM departments WHERE org_id=? ORDER BY name LIMIT 100",org),
            "teams",db.queryForList("""
                SELECT t.id,t.name,t.department_id AS "departmentId",
                  COALESCE((SELECT json_agg(m.user_id)::text FROM team_members m WHERE m.org_id=t.org_id AND m.team_id=t.id),'[]') AS "memberIds"
                FROM teams t WHERE t.org_id=? ORDER BY t.name LIMIT 100
                """,org));
    }

    @PostMapping("/departments")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> department(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Entry body) {
        tenants.require(org,user,Tenants.ADMIN);
        var value=db.queryForMap("INSERT INTO departments(org_id,name) VALUES (?,?) RETURNING id,name",org,body.name().strip());
        tenants.audit(org,user.id(),"department.created",body.name());
        return value;
    }

    @PostMapping("/teams")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> team(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Entry body) {
        tenants.require(org,user,Tenants.ADMIN);
        var value=db.queryForMap("INSERT INTO teams(org_id,name,department_id) VALUES (?,?,?) RETURNING id,name",org,body.name().strip(),body.departmentId());
        tenants.audit(org,user.id(),"team.created",body.name());
        return value;
    }

    @PatchMapping("/teams/{id}/members")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    void assign(@PathVariable UUID org,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Membership body) {
        tenants.require(org,user,Tenants.ADMIN);
        tenants.requirePerson(org,body.userId());
        if (body.assigned()) db.update("INSERT INTO team_members(org_id,team_id,user_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",org,id,body.userId());
        else db.update("DELETE FROM team_members WHERE org_id=? AND team_id=? AND user_id=?",org,id,body.userId());
        tenants.audit(org,user.id(),body.assigned()?"team.member_assigned":"team.member_removed",id.toString());
    }
}
