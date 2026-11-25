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
class WorkDetailsController {
    record Title(@NotBlank @Size(max=120) String title) {}
    record Done(boolean done) {}
    record Dependency(@NotNull UUID prerequisiteId) {}
    record Label(@Pattern(regexp="[a-zA-Z0-9][a-zA-Z0-9 _-]{0,29}") @NotNull String name) {}
    record Milestone(@NotBlank @Size(max=120) String title,LocalDate dueDate) {}
    record Move(@NotNull UUID id,@PositiveOrZero long version) {}
    record Bulk(@NotEmpty @Size(max=50) List<@Valid Move> tasks,@NotNull @Pattern(regexp="Planned|In progress|Completed") String status) {}

    private final JdbcTemplate db;
    private final Tenants tenants;
    private final TaskRepository tasks;
    private final WorkController work;

    WorkDetailsController(JdbcTemplate db,Tenants tenants,TaskRepository tasks,WorkController work) {
        this.db=db;this.tenants=tenants;this.tasks=tasks;this.work=work;
    }

    @GetMapping("/tasks/{task}/details")
    Map<String,Object> details(@PathVariable UUID org,@PathVariable UUID task,@AuthenticationPrincipal Sessions.User user) {
        authorize(org,task,user,false);
        return Map.of(
            "subtasks",db.queryForList("SELECT id,title,done FROM subtasks WHERE org_id=? AND task_id=? ORDER BY created_at,id LIMIT 100",org,task),
            "dependencies",db.queryForList("""
                SELECT t.id,t.title,t.status FROM task_dependencies d JOIN tasks t ON t.org_id=d.org_id AND t.id=d.prerequisite_id
                WHERE d.org_id=? AND d.task_id=? ORDER BY t.title LIMIT 100
                """,org,task),
            "labels",db.queryForList("SELECT name FROM task_labels WHERE org_id=? AND task_id=? ORDER BY name LIMIT 40",String.class,org,task),
            "history",db.queryForList("""
                SELECT h.id,u.name,h.action,h.status,h.created_at AS "createdAt" FROM task_history h JOIN users u ON u.id=h.actor_id
                WHERE h.org_id=? AND h.task_id=? ORDER BY h.created_at DESC LIMIT 20
                """,org,task));
    }

    @PostMapping("/tasks/{task}/subtasks")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> createSubtask(@PathVariable UUID org,@PathVariable UUID task,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Title body) {
        authorize(org,task,user,true);
        return db.queryForMap("INSERT INTO subtasks(org_id,task_id,title) VALUES (?,?,?) RETURNING id,title,done",org,task,body.title().strip());
    }

    @PatchMapping("/tasks/{task}/subtasks/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void subtask(@PathVariable UUID org,@PathVariable UUID task,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user,@RequestBody Done body) {
        authorize(org,task,user,true);
        if (db.update("UPDATE subtasks SET done=? WHERE org_id=? AND task_id=? AND id=?",body.done(),org,task,id)==0)
            throw status(HttpStatus.NOT_FOUND,"Subtask could not be found.");
    }

    @PostMapping("/tasks/{task}/dependencies")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> addDependency(@PathVariable UUID org,@PathVariable UUID task,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Dependency body) {
        authorize(org,task,user,true);
        if (task.equals(body.prerequisiteId()) || !tasks.existsByIdAndOrgId(body.prerequisiteId(),org))
            throw status(HttpStatus.BAD_REQUEST,"Choose another task from this workspace.");
        db.execute((org.springframework.jdbc.core.ConnectionCallback<Void>) connection->{
            try (var lock=connection.prepareStatement("SELECT pg_advisory_xact_lock(hashtextextended(?, 812033))")) {
                lock.setString(1,org.toString());
                lock.execute();
            }
            return null;
        });
        boolean cycle=Boolean.TRUE.equals(db.queryForObject("""
            WITH RECURSIVE prerequisites(id) AS (
              SELECT prerequisite_id FROM task_dependencies WHERE org_id=? AND task_id=?
              UNION
              SELECT d.prerequisite_id FROM task_dependencies d JOIN prerequisites p ON d.task_id=p.id WHERE d.org_id=?
            )
            SELECT EXISTS(SELECT 1 FROM prerequisites WHERE id=?)
            """,Boolean.class,org,body.prerequisiteId(),org,task));
        if (cycle) throw status(HttpStatus.CONFLICT,"This dependency would create a cycle.");
        db.update("INSERT INTO task_dependencies(org_id,task_id,prerequisite_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",org,task,body.prerequisiteId());
        return Map.of("id",body.prerequisiteId());
    }

    @DeleteMapping("/tasks/{task}/dependencies/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void removeDependency(@PathVariable UUID org,@PathVariable UUID task,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user) {
        authorize(org,task,user,true);
        db.update("DELETE FROM task_dependencies WHERE org_id=? AND task_id=? AND prerequisite_id=?",org,task,id);
    }

    @PostMapping("/tasks/{task}/labels")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    Map<String,Object> addLabel(@PathVariable UUID org,@PathVariable UUID task,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Label body) {
        authorize(org,task,user,true);
        String name=body.name().strip().toLowerCase(Locale.ROOT);
        db.update("INSERT INTO labels(org_id,name) VALUES (?,?) ON CONFLICT DO NOTHING",org,name);
        db.update("INSERT INTO task_labels(org_id,task_id,name) VALUES (?,?,?) ON CONFLICT DO NOTHING",org,task,name);
        return Map.of("name",name);
    }

    @DeleteMapping("/tasks/{task}/labels/{name}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void removeLabel(@PathVariable UUID org,@PathVariable UUID task,@PathVariable String name,@AuthenticationPrincipal Sessions.User user) {
        authorize(org,task,user,true);
        db.update("DELETE FROM task_labels WHERE org_id=? AND task_id=? AND name=?",org,task,name);
    }

    @GetMapping("/projects/{project}/milestones")
    List<Map<String,Object>> milestones(@PathVariable UUID org,@PathVariable UUID project,@AuthenticationPrincipal Sessions.User user) {
        tenants.require(org,user);
        requireProject(org,project);
        return db.queryForList("""
            SELECT id,title,due_date AS "dueDate",done FROM milestones WHERE org_id=? AND project_id=? ORDER BY due_date NULLS LAST,id LIMIT 100
            """,org,project);
    }

    @PostMapping("/projects/{project}/milestones")
    @ResponseStatus(HttpStatus.CREATED)
    Map<String,Object> milestone(@PathVariable UUID org,@PathVariable UUID project,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Milestone body) {
        tenants.require(org,user,Tenants.MANAGE);
        requireProject(org,project);
        return db.queryForMap("INSERT INTO milestones(org_id,project_id,title,due_date) VALUES (?,?,?,?) RETURNING id,title,due_date AS \"dueDate\",done",
            org,project,body.title().strip(),body.dueDate());
    }

    @PatchMapping("/projects/{project}/milestones/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void milestoneDone(@PathVariable UUID org,@PathVariable UUID project,@PathVariable UUID id,@AuthenticationPrincipal Sessions.User user,@RequestBody Done body) {
        tenants.require(org,user,Tenants.MANAGE);
        if (db.update("UPDATE milestones SET done=? WHERE org_id=? AND project_id=? AND id=?",body.done(),org,project,id)==0)
            throw status(HttpStatus.NOT_FOUND,"Milestone could not be found.");
    }

    @PostMapping("/tasks/bulk")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    void bulk(@PathVariable UUID org,@AuthenticationPrincipal Sessions.User user,@Valid @RequestBody Bulk body) {
        tenants.require(org,user,Tenants.CONTRIBUTE);
        var ordered=body.tasks().stream().sorted(Comparator.comparing(Move::id)).toList();
        if (ordered.stream().map(Move::id).distinct().count()!=ordered.size()) throw status(HttpStatus.BAD_REQUEST,"A task appears twice in this selection.");
        for (Move move:ordered) {
            var row=db.queryForList("SELECT project_id,title,description,priority,due_date,assignee FROM tasks WHERE org_id=? AND id=? FOR UPDATE",org,move.id())
                .stream().findFirst().orElseThrow(()->status(HttpStatus.NOT_FOUND,"A selected task could not be found."));
            var date=(java.sql.Date)row.get("due_date");
            work.updateTask(org,move.id(),user,new WorkController.TaskBody((UUID)row.get("project_id"),(String)row.get("title"),(String)row.get("description"),
                body.status(),(String)row.get("priority"),date==null?null:date.toLocalDate(),(UUID)row.get("assignee"),move.version()));
        }
    }

    private void authorize(UUID org,UUID task,Sessions.User user,boolean writable) {
        if (writable) tenants.require(org,user,Tenants.CONTRIBUTE);
        else tenants.require(org,user);
        if (!tasks.existsByIdAndOrgId(task,org)) throw status(HttpStatus.NOT_FOUND,"Task could not be found.");
    }

    private void requireProject(UUID org,UUID project) {
        if (!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM projects WHERE org_id=? AND id=?)",Boolean.class,org,project)))
            throw status(HttpStatus.NOT_FOUND,"Project could not be found.");
    }
}
