package com.nexusflow.core;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import static com.nexusflow.core.AuthController.status;

@Service
class Tenants {
    static final Set<String> ADMIN = Set.of("Owner","Admin");
    static final Set<String> MANAGE = Set.of("Owner","Admin","Project Manager");
    static final Set<String> CONTRIBUTE = Set.of("Owner","Admin","Project Manager","Member");
    private final JdbcTemplate db;
    Tenants(JdbcTemplate db) {this.db=db;}

    String require(UUID org, Sessions.User user) {
        return db.query("SELECT role FROM memberships WHERE org_id=? AND user_id=?",(row,i)->row.getString("role"),org,user.id())
            .stream().findFirst().orElseThrow(()->status(HttpStatus.FORBIDDEN,"You do not belong to this workspace."));
    }

    void require(UUID org,Sessions.User user,Set<String> allowed) {
        if (!allowed.contains(require(org,user))) throw status(HttpStatus.FORBIDDEN,"Your workspace role does not allow this action.");
    }

    void requirePerson(UUID org,UUID user) {
        if (user!=null && !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS (SELECT 1 FROM memberships WHERE org_id=? AND user_id=?)",Boolean.class,org,user)))
            throw status(HttpStatus.BAD_REQUEST,"Select a member of this workspace.");
    }

    void audit(UUID org,UUID actor,String action,String target) {
        db.update("INSERT INTO audit_logs(org_id,actor_id,action,target) VALUES (?,?,?,?)",org,actor,action,target);
    }
}
