package com.nexusflow.core;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import static com.nexusflow.core.AuthController.status;

@RestController
@RequestMapping("/api/orgs")
class WorkspaceController {
    record Name(@NotBlank @Size(max=100) String name) {}
    record Plan(@Pattern(regexp="Free|Professional|Enterprise") @NotNull String plan) {}
    record Invite(@NotBlank @Email @Size(max=254) String email,@NotNull @Pattern(regexp="Admin|Project Manager|Member|Viewer") String role) {}
    record Token(@NotBlank @Size(max=100) String token) {}
    record Role(@NotNull @Pattern(regexp="Admin|Project Manager|Member|Viewer") String role) {}
    private final JdbcTemplate db;
    private final Tenants tenants;
    private final Events events;
    private final String billing;

    WorkspaceController(JdbcTemplate db,Tenants tenants,Events events,@Value("${nexus.billing}") String billing) {
        this.db=db;this.tenants=tenants;this.events=events;this.billing=billing;
    }

    @GetMapping
    List<Map<String,Object>> list(@AuthenticationPrincipal Sessions.User user) {
        return db.queryForList("""
            SELECT o.id,o.name,o.plan,m.role FROM memberships m JOIN organizations o ON o.id=m.org_id
            WHERE m.user_id=? ORDER BY o.created_at,o.id
            """,user.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> create(@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Name body) {
        UUID id=db.queryForObject("INSERT INTO organizations(name) VALUES (?) RETURNING id",UUID.class,body.name().strip());
        db.update("INSERT INTO memberships(org_id,user_id,role) VALUES (?,?,'Owner')",id,user.id());
        tenants.audit(id,user.id(),"organization.created",body.name());
        events.add(id,"organization.created",Map.of("actorId",user.id(),"title",body.name()));
        return Map.of("id",id,"name",body.name().strip(),"plan","Free","role","Owner");
    }

    @GetMapping("/{org}/membership")
    Map<String,Object> membership(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user) {
        return Map.of("id",user.id(),"name",user.name(),"role",tenants.require(org,user));
    }

    @GetMapping("/{org}/snapshot")
    @Transactional(readOnly=true)
    Map<String,Object> snapshot(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user) {
        String role=tenants.require(org,user);
        var projects=db.queryForList("""
            SELECT p.id,p.title,p.description,p.status,p.priority,p.team,p.start_date AS "startDate",p.due_date AS "dueDate",p.owner,p.archived,
              COALESCE((SELECT round(100.0*count(*) FILTER (WHERE t.status='Completed') / NULLIF(count(*),0))::int
                FROM tasks t WHERE t.org_id=p.org_id AND t.project_id=p.id),0) AS progress
            FROM projects p WHERE p.org_id=? ORDER BY p.created_at,p.id LIMIT 500
            """,org);
        var tasks=db.queryForList("""
            SELECT id,project_id AS "projectId",title,description,status,priority,due_date AS "dueDate",assignee,version,
              updated_at AS "updatedAt", created_at AS "createdAt", completed_at AS "completedAt"
            FROM tasks WHERE org_id=? ORDER BY updated_at DESC,id LIMIT 2000
            """,org);
        var team=db.queryForList("""
            SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id
            WHERE m.org_id=? ORDER BY u.name LIMIT 1000
            """,org);
        var rules=db.queryForList("SELECT id,title,trigger,priority,message,active FROM workflow_rules WHERE org_id=? ORDER BY title LIMIT 100",org);
        var audit=Tenants.ADMIN.contains(role)?db.queryForList("""
            SELECT id,action,target,created_at AS "createdAt" FROM audit_logs WHERE org_id=? ORDER BY created_at DESC LIMIT 100
            """,org):List.of();
        var invoices=Tenants.ADMIN.contains(role)?db.queryForList("""
            SELECT id,plan,amount,created_at AS "createdAt" FROM invoices WHERE org_id=? ORDER BY created_at DESC LIMIT 100
            """,org):List.of();
        var teams=db.queryForList("SELECT name FROM teams WHERE org_id=? ORDER BY name LIMIT 100",String.class,org);
        return Map.of("projects",projects,"tasks",tasks,"team",team,"rules",rules,"audit",audit,"invoices",invoices,"teams",teams);
    }

    @PatchMapping("/{org}/settings")
    @Transactional
    Map<String,Object> rename(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Name body) {
        tenants.require(org,user,Tenants.ADMIN);
        String name=body.name().strip();
        db.update("UPDATE organizations SET name=? WHERE id=?",name,org);
        tenants.audit(org,user.id(),"organization.updated",name);
        return Map.of("name",name);
    }

    @PatchMapping("/{org}/billing")
    @Transactional
    Map<String,Object> billing(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Plan body) {
        tenants.require(org,user,Set.of("Owner"));
        if (!"mock".equals(billing)) throw status(HttpStatus.SERVICE_UNAVAILABLE,"Billing is disabled in this environment.");
        String previous=db.queryForObject("SELECT plan FROM organizations WHERE id=? FOR UPDATE",String.class,org);
        if (body.plan().equals(previous)) return Map.of("plan",previous);
        requireCapacity(org,body.plan(),0);
        db.update("UPDATE organizations SET plan=? WHERE id=?",body.plan(),org);
        db.update("INSERT INTO invoices(org_id,plan,amount) VALUES (?,?,?)",org,body.plan(),body.plan().equals("Professional") ? 2400 : 0);
        tenants.audit(org,user.id(),"subscription.updated",body.plan());
        events.add(org,"subscription.updated",Map.of("actorId",user.id(),"plan",body.plan()));
        return Map.of("plan",body.plan(),"provider","mock");
    }

    @GetMapping("/{org}/invitations")
    List<Map<String,Object>> invites(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user) {
        tenants.require(org,user,Tenants.ADMIN);
        return db.queryForList("""
            SELECT id,email,role,expires_at AS "expiresAt" FROM invitations WHERE org_id=? AND expires_at>now() ORDER BY expires_at DESC LIMIT 100
            """,org);
    }

    @PostMapping("/{org}/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> invite(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Invite body) {
        tenants.require(org,user,Tenants.ADMIN);
        if ("Admin".equals(body.role()) && !"Owner".equals(tenants.require(org,user))) throw status(HttpStatus.FORBIDDEN,"Only owners can invite administrators.");
        String email=AuthController.normalize(body.email());
        if (Boolean.TRUE.equals(db.queryForObject("""
            SELECT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=? AND u.email=?)
            """,Boolean.class,org,email))) throw status(HttpStatus.CONFLICT,"This email already belongs to a workspace member.");
        String token=Sessions.token();
        var invite=db.queryForMap("""
            INSERT INTO invitations(org_id,email,role,token_hash,expires_at) VALUES (?,?,?,?,now()+interval '7 days')
            ON CONFLICT (org_id,email) DO UPDATE SET role=EXCLUDED.role,token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at
            RETURNING id,email,role,expires_at AS "expiresAt"
            """,org,email,body.role(),Sessions.hash(token));
        invite.put("token",token);
        tenants.audit(org,user.id(),"member.invited",email);
        events.add(org,"member.invited",Map.of("actorId",user.id(),"title",email));
        return invite;
    }

    @DeleteMapping("/{org}/invitations/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    void revoke(@PathVariable UUID org,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user) {
        tenants.require(org,user,Tenants.ADMIN);
        db.update("DELETE FROM invitations WHERE org_id=? AND id=? AND (role<>'Admin' OR ?='Owner')",org,id,tenants.require(org,user));
        tenants.audit(org,user.id(),"invitation.revoked",id.toString());
    }

    @PostMapping("/accept-invitation")
    @Transactional
    Map<String,Object> accept(@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Token body) {
        var invite=db.queryForList("""
            DELETE FROM invitations WHERE token_hash=? AND email=? AND expires_at>now() RETURNING org_id,role
            """,Sessions.hash(body.token()),user.email()).stream().findFirst()
            .orElseThrow(()->status(HttpStatus.NOT_FOUND,"This invitation is invalid or expired."));
        UUID org=(UUID)invite.get("org_id");
        String plan=db.queryForObject("SELECT plan FROM organizations WHERE id=? FOR UPDATE",String.class,org);
        requireCapacity(org,plan,1);
        if (db.update("INSERT INTO memberships(org_id,user_id,role) VALUES (?,?,?) ON CONFLICT DO NOTHING",org,user.id(),invite.get("role"))>0) {
            tenants.audit(org,user.id(),"member.joined",user.name());
            events.add(org,"member.joined",Map.of("actorId",user.id(),"recipientId",user.id(),"title",user.name()));
        }
        return Map.of("id",org);
    }

    @PatchMapping("/{org}/members/{id}")
    @Transactional
    Map<String,Object> role(@PathVariable UUID org,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Role body) {
        tenants.require(org,user,Tenants.ADMIN);
        String actor=tenants.require(org,user);
        if ("Admin".equals(body.role()) && !"Owner".equals(actor)) throw status(HttpStatus.FORBIDDEN,"Only owners can assign administrators.");
        if (db.update("UPDATE memberships SET role=? WHERE org_id=? AND user_id=? AND role<>'Owner' AND (role<>'Admin' OR ?='Owner') AND user_id<>?",body.role(),org,id,actor,user.id())==0)
            throw status(HttpStatus.FORBIDDEN,"This role cannot be changed.");
        tenants.audit(org,user.id(),"member.role_updated",id.toString());
        return Map.of("id",id,"role",body.role());
    }

    private void requireCapacity(UUID org,String plan,int additional) {
        int limit=switch(plan) {case "Free" -> 5; case "Professional" -> 100; default -> 1000;};
        Integer members=db.queryForObject("SELECT count(*) FROM memberships WHERE org_id=?",Integer.class,org);
        if (members!=null && members+additional>limit) throw status(HttpStatus.CONFLICT,"This plan's workspace member limit would be exceeded.");
    }
}
