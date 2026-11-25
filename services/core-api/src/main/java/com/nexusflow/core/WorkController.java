package com.nexusflow.core;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import static com.nexusflow.core.AuthController.status;

@RestController
@RequestMapping("/api/orgs/{org}")
class WorkController {
    private static final String STATUSES="Planned|In progress|Completed";
    private static final String PRIORITIES="Low|Medium|High|Urgent";
    record ProjectBody(@NotBlank @Size(max=120) String title,@NotNull @Size(max=2000) String description,
        @NotNull @Pattern(regexp=STATUSES) String status,@NotNull @Pattern(regexp=PRIORITIES) String priority,
        @NotBlank @Size(max=80) String team,LocalDate startDate,LocalDate dueDate,UUID owner,boolean archived) {}
    record TaskBody(@NotNull UUID projectId,@NotBlank @Size(max=120) String title,@NotNull @Size(max=2000) String description,
        @NotNull @Pattern(regexp=STATUSES) String status,@NotNull @Pattern(regexp=PRIORITIES) String priority,
        LocalDate dueDate,UUID assignee,@PositiveOrZero Long version) {}
    record Note(@NotBlank @Size(max=2000) String body) {}
    record RuleBody(@NotBlank @Size(max=120) String title,
        @NotNull @Pattern(regexp="task[.](created|completed|overdue|due_soon)|project[.]completed|member[.]joined") String trigger,
        @NotNull @Pattern(regexp=PRIORITIES+"|Any") String priority,@NotBlank @Size(max=500) String message,boolean active) {}
    private final JdbcTemplate db;
    private final Tenants tenants;
    private final Events events;
    private final TaskRepository tasks;

    WorkController(JdbcTemplate db,Tenants tenants,Events events,TaskRepository tasks) {
        this.db=db;this.tenants=tenants;this.events=events;this.tasks=tasks;
    }

    @PostMapping("/projects")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> createProject(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody ProjectBody body) {
        tenants.require(org,user,Tenants.MANAGE);
        validateProject(org,body);
        checkLimit(org,"projects",15,150,500);
        UUID id=db.queryForObject("""
            INSERT INTO projects(org_id,title,description,status,priority,team,start_date,due_date,owner,archived)
            VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id
            """,UUID.class,org,body.title().strip(),body.description(),body.status(),body.priority(),body.team(),body.startDate(),body.dueDate(),body.owner(),body.archived());
        projectEvent(org,user,id,body,"project.created");
        if ("Completed".equals(body.status())) projectEvent(org,user,id,body,"project.completed");
        return Map.of("id",id);
    }

    @PatchMapping("/projects/{id}")
    @Transactional
    Map<String,Object> updateProject(@PathVariable UUID org,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody ProjectBody body) {
        tenants.require(org,user,Tenants.MANAGE);
        String before=db.query("SELECT status FROM projects WHERE org_id=? AND id=? FOR UPDATE",(row,i)->row.getString(1),org,id)
            .stream().findFirst().orElseThrow(()->status(HttpStatus.NOT_FOUND,"Project could not be found."));
        validateProject(org,body);
        db.update("""
            UPDATE projects SET title=?,description=?,status=?,priority=?,team=?,start_date=?,due_date=?,owner=?,archived=?
            WHERE org_id=? AND id=?
            """,body.title().strip(),body.description(),body.status(),body.priority(),body.team(),body.startDate(),body.dueDate(),body.owner(),body.archived(),org,id);
        tenants.audit(org,user.id(),"project.updated",body.title());
        if (!"Completed".equals(before) && "Completed".equals(body.status())) projectEvent(org,user,id,body,"project.completed");
        return Map.of("id",id);
    }

    @PostMapping("/tasks")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> createTask(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody TaskBody body) {
        tenants.require(org,user,Tenants.CONTRIBUTE);
        validateTask(org,body);
        UUID id=db.queryForObject("""
            INSERT INTO tasks(org_id,project_id,title,description,status,priority,due_date,assignee,completed_at)
            VALUES (?,?,?,?,?,?,?,?,CASE WHEN ?='Completed' THEN now() END) RETURNING id
            """,UUID.class,org,body.projectId(),body.title().strip(),body.description(),body.status(),body.priority(),body.dueDate(),body.assignee(),body.status());
        taskEvent(org,user,id,body,"task.created");
        if ("Completed".equals(body.status())) taskEvent(org,user,id,body,"task.completed");
        return Map.of("id",id,"version",0);
    }

    @PatchMapping("/tasks/{id}")
    @Transactional
    Map<String,Object> updateTask(@PathVariable UUID org,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody TaskBody body) {
        tenants.require(org,user,Tenants.CONTRIBUTE);
        var previous=db.queryForList("SELECT status,version,project_id FROM tasks WHERE org_id=? AND id=? FOR UPDATE",org,id)
            .stream().findFirst().orElseThrow(()->status(HttpStatus.NOT_FOUND,"Task could not be found."));
        if (!Objects.equals(body.version(),previous.get("version"))) throw status(HttpStatus.CONFLICT,"This task changed. Reload and try again.");
        if (!body.projectId().equals(previous.get("project_id"))) validateTask(org,body);
        else tenants.requirePerson(org,body.assignee());
        long version=db.queryForObject("""
            UPDATE tasks SET project_id=?,title=?,description=?,status=?,priority=?,due_date=?,assignee=?,version=version+1,updated_at=now(),
              completed_at=CASE WHEN ?='Completed' THEN COALESCE(completed_at,now()) ELSE NULL END,
              overdue_event_date=CASE WHEN due_date IS DISTINCT FROM ? OR assignee IS DISTINCT FROM ? THEN NULL ELSE overdue_event_date END,
              reminder_event_date=CASE WHEN due_date IS DISTINCT FROM ? OR assignee IS DISTINCT FROM ? THEN NULL ELSE reminder_event_date END
            WHERE org_id=? AND id=? AND version=? RETURNING version
            """,Long.class,body.projectId(),body.title().strip(),body.description(),body.status(),body.priority(),body.dueDate(),body.assignee(),body.status(),body.dueDate(),body.assignee(),body.dueDate(),body.assignee(),org,id,body.version());
        taskEvent(org,user,id,body,"task.updated");
        if (!"Completed".equals(previous.get("status")) && "Completed".equals(body.status())) taskEvent(org,user,id,body,"task.completed");
        return Map.of("id",id,"version",version);
    }

    @GetMapping("/tasks/{id}/comments")
    List<Map<String,Object>> comments(@PathVariable UUID org,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user) {
        tenants.require(org,user);
        requireTask(org,id);
        return db.queryForList("""
            SELECT c.id,u.name,c.body,c.created_at AS "createdAt" FROM comments c JOIN users u ON u.id=c.author_id
            WHERE c.org_id=? AND c.task_id=? ORDER BY c.created_at,c.id LIMIT 200
            """,org,id);
    }

    @PostMapping("/tasks/{id}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> comment(@PathVariable UUID org,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Note body) {
        tenants.require(org,user,Tenants.CONTRIBUTE);
        requireTask(org,id);
        UUID comment=db.queryForObject("INSERT INTO comments(org_id,task_id,author_id,body) VALUES (?,?,?,?) RETURNING id",UUID.class,org,id,user.id(),body.body().strip());
        return Map.of("id",comment);
    }

    @PostMapping("/rules")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> createRule(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody RuleBody body) {
        tenants.require(org,user,Tenants.MANAGE);
        checkLimit(org,"workflow_rules",3,50,250);
        UUID id=db.queryForObject("INSERT INTO workflow_rules(org_id,title,trigger,priority,message,active) VALUES (?,?,?,?,?,?) RETURNING id",
            UUID.class,org,body.title().strip(),body.trigger(),body.priority(),body.message().strip(),body.active());
        tenants.audit(org,user.id(),"workflow.created",body.title());
        return Map.of("id",id);
    }

    @PatchMapping("/rules/{id}")
    @Transactional
    Map<String,Object> updateRule(@PathVariable UUID org,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody RuleBody body) {
        tenants.require(org,user,Tenants.MANAGE);
        if (db.update("UPDATE workflow_rules SET title=?,trigger=?,priority=?,message=?,active=? WHERE org_id=? AND id=?",
            body.title().strip(),body.trigger(),body.priority(),body.message().strip(),body.active(),org,id)==0) throw status(HttpStatus.NOT_FOUND,"Workflow could not be found.");
        tenants.audit(org,user.id(),"workflow.updated",body.title());
        return Map.of("id",id);
    }

    @GetMapping("/executions")
    List<Map<String,Object>> executions(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user) {
        tenants.require(org,user);
        return db.queryForList("""
            SELECT e.id,e.rule_id AS "ruleId",r.title,e.created_at AS "createdAt",e.status
            FROM workflow_executions e JOIN workflow_rules r ON (r.org_id=e.org_id AND r.id=e.rule_id)
            WHERE e.org_id=? ORDER BY e.created_at DESC LIMIT 100
            """,org);
    }

    private void checkLimit(UUID org,String resource,int free,int professional,int enterprise) {
        String plan=db.queryForObject("SELECT plan FROM organizations WHERE id=? FOR UPDATE",String.class,org);
        int limit=switch(plan) {case "Free" -> free; case "Professional" -> professional; default -> enterprise;};
        String query=switch(resource) {
            case "projects" -> "SELECT count(*) FROM projects WHERE org_id=?";
            case "workflow_rules" -> "SELECT count(*) FROM workflow_rules WHERE org_id=?";
            default -> throw new IllegalArgumentException("Unsupported plan resource");
        };
        Integer used=db.queryForObject(query,Integer.class,org);
        if (used!=null&&used>=limit) throw status(HttpStatus.CONFLICT,"This workspace has reached its plan limit.");
    }

    private void requireTask(UUID org,UUID id) {
        if (!tasks.existsByIdAndOrgId(id,org)) throw status(HttpStatus.NOT_FOUND,"Task could not be found.");
    }

    private void validateProject(UUID org,ProjectBody body) {
        tenants.requirePerson(org,body.owner());
        if (body.startDate()!=null && body.dueDate()!=null && body.startDate().isAfter(body.dueDate()))
            throw status(HttpStatus.BAD_REQUEST,"Due date must be on or after the start date.");
    }

    private void validateTask(UUID org,TaskBody body) {
        tenants.requirePerson(org,body.assignee());
        if (!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM projects WHERE org_id=? AND id=? AND NOT archived)",Boolean.class,org,body.projectId())))
            throw status(HttpStatus.BAD_REQUEST,"Select an active project in this workspace.");
    }

    private void projectEvent(UUID org,Sessions.User user,UUID id,ProjectBody body,String type) {
        tenants.audit(org,user.id(),type,body.title());
        events.add(org,type,Map.of("actorId",user.id(),"recipientId",body.owner()==null?user.id():body.owner(),"projectId",id,"priority",body.priority(),"title",body.title()));
    }

    private void taskEvent(UUID org,Sessions.User user,UUID id,TaskBody body,String type) {
        db.update("INSERT INTO task_history(org_id,task_id,actor_id,action,status) VALUES (?,?,?,?,?)",org,id,user.id(),type,body.status());
        tenants.audit(org,user.id(),type,body.title());
        UUID recipient=body.assignee();
        if ("task.completed".equals(type)) recipient=db.queryForObject("SELECT owner FROM projects WHERE org_id=? AND id=?",UUID.class,org,body.projectId());
        events.add(org,type,Map.of("actorId",user.id(),"recipientId",recipient==null?user.id():recipient,"taskId",id,
            "projectId",body.projectId(),"priority",body.priority(),"title",body.title()));
    }
}
