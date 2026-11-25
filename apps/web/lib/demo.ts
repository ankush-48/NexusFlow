import fixture from "./fixture.json";
import type { Milestone, TaskDetails } from "../components/work-details";
import { ApiError } from "./api";
import {
  dateOffset,
  type Audit,
  type Channel,
  type Comment,
  type Execution,
  type Invitation,
  type Message,
  type Notice,
  type Org,
  type Person,
  type Project,
  type Rule,
  type Snapshot,
  type Task,
} from "./model";

type DemoOrg = Snapshot & {
  invitations: Invitation[];
  comments: Record<string, Comment[]>;
  executions: Execution[];
  notices: Notice[];
  emailNotices?: boolean;
  directory?: {
    departments: { id: string; name: string }[];
    teams: {
      id: string;
      name: string;
      departmentId: string | null;
      memberIds: string;
    }[];
  };
  details?: Record<string, TaskDetails>;
  milestones?: Record<string, Milestone[]>;
  channels: Channel[];
  messages: Record<string, Message[]>;
};
type DemoState = { orgs: Org[]; user: Person; data: Record<string, DemoOrg> };
const key = "nexusflow-preview-v2";
const taskTitles = [
  "Confirm release scope",
  "Review implementation details",
  "Prepare test fixtures",
  "Document the onboarding flow",
  "Validate accessibility",
  "Run acceptance checks",
  "Review monitoring and alerts",
  "Share rollout notes",
];
const timestamp = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function emptyOrg(): DemoOrg {
  return {
    projects: [],
    tasks: [],
    team: [],
    rules: [],
    audit: [],
    invoices: [],
    invitations: [],
    comments: {},
    executions: [],
    notices: [],
    channels: [{ id: id(), name: "general" }],
    messages: {},
  };
}

function seed(): DemoState {
  const user = fixture.people[0];
  const data = Object.fromEntries(
    fixture.orgs.map((org, index) => {
      const item = emptyOrg();
      item.team = fixture.people;
      const projects = fixture.projects.filter(
        (project) => project.org === index + 1,
      );
      item.projects = projects.map((project) => ({
        ...project,
        dueDate: dateOffset(project.due),
        startDate: dateOffset(project.start),
        progress: 0,
        archived: false,
      }));
      item.tasks = projects.flatMap((project) => {
        const i = fixture.projects.indexOf(project);
        return taskTitles.map((title, j): Task => {
          const status =
            project.status === "Completed" ||
            (project.status === "In progress" && j < 2 + (i % 5))
              ? "Completed"
              : project.status === "In progress" && j < 6
                ? "In progress"
                : "Planned";
          return {
            id: project.id + "-" + j,
            projectId: project.id,
            title,
            description:
              "Coordinate with " +
              project.team +
              " and record the outcome in the project.",
            status,
            priority: j === 1 ? "High" : j === 6 ? "Low" : "Medium",
            dueDate: dateOffset(project.due - j),
            assignee: fixture.people[(i + j) % fixture.people.length].id,
            version: 0,
            updatedAt: dateOffset(-j - 1),
            completedAt: status === "Completed" ? dateOffset(-j - 1 - i) : null,
          };
        });
      });
      item.channels = fixture.channels;
      if (index === 0) {
        item.messages[fixture.channels[0].id] = fixture.messages.map(
          (message) => ({
            ...message,
            createdAt: new Date(
              Date.now() + message.offset * 60_000,
            ).toISOString(),
          }),
        );
        item.rules = fixture.rules;
        item.notices = [
          {
            id: id(),
            title: "Workspace onboarding is due this week.",
            read: false,
            createdAt: dateOffset(0),
          },
          {
            id: id(),
            title: "Access control rollout was completed.",
            read: false,
            createdAt: dateOffset(-3),
          },
        ];
        item.audit = [
          {
            id: id(),
            action: "project.completed",
            target: "Access control rollout",
            createdAt: dateOffset(-3),
          },
          {
            id: id(),
            action: "project.created",
            target: "Customer insights hub",
            createdAt: dateOffset(-5),
          },
        ];
      }
      return [org.id, item];
    }),
  );
  return { orgs: fixture.orgs, user, data };
}

function execute(org: DemoOrg, trigger: string, priority = "Any") {
  for (const rule of org.rules.filter(
    (rule) =>
      rule.active &&
      rule.trigger === trigger &&
      (rule.priority === "Any" || rule.priority === priority),
  )) {
    org.notices.unshift({
      id: id(),
      title: rule.message,
      read: false,
      createdAt: timestamp(),
    });
    org.executions.unshift({
      id: id(),
      ruleId: rule.id,
      title: rule.title,
      status: "Succeeded",
      createdAt: timestamp(),
    });
  }
}
function record(org: DemoOrg, action: string, target: string) {
  const entry: Audit = { id: id(), action, target, createdAt: timestamp() };
  org.audit.unshift(entry);
}
function saveItem<T extends { id: string }>(
  items: T[],
  itemId: string | undefined,
  values: Omit<T, "id">,
): T {
  const existing = items.find((item) => item.id === itemId);
  if (itemId && !existing)
    throw new ApiError("This record could not be found.", 404);
  if (existing) return Object.assign(existing, values);
  const item = { ...values, id: id() } as T;
  items.push(item);
  return item;
}

export async function demoApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let state: DemoState;
  try {
    state = JSON.parse(localStorage.getItem(key) ?? "null") ?? seed();
  } catch {
    state = seed();
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const [route, query] = path.split("?");
  const [base, orgId, collection, itemId, child] = route.split("/");
  const org = orgId ? state.data[orgId] : undefined;
  const organization = state.orgs.find((item) => item.id === orgId);
  let result: unknown;
  if (path === "auth/me") result = state.user;
  else if (path === "orgs" && method === "GET") result = state.orgs;
  else if (path === "orgs" && method === "POST") {
    const created = {
      id: id(),
      name: String(payload.name),
      plan: "Free",
      role: "Owner",
    };
    state.orgs.push(created);
    state.data[created.id] = { ...emptyOrg(), team: [state.user] };
    result = created;
  } else if (path === "auth/profile" && method === "PATCH") {
    state.user.name = String(payload.name);
    result = state.user;
  } else if ((base === "orgs" || base === "collab") && org && organization) {
    if (collection === "snapshot") {
      const projects = org.projects.map((project) => {
        const tasks = org.tasks.filter((task) => task.projectId === project.id);
        const progress = tasks.length
          ? Math.round(
              (100 *
                tasks.filter((task) => task.status === "Completed").length) /
                tasks.length,
            )
          : 0;
        return { ...project, progress };
      });
      result = {
        projects,
        tasks: org.tasks,
        team: org.team,
        audit: org.audit,
        rules: org.rules,
        invoices: org.invoices,
        teams: org.directory?.teams.map((team) => team.name) ?? [],
      };
    } else if (collection === "projects" && child === "milestones" && itemId) {
      if (!org.projects.some((project) => project.id === itemId))
        throw new ApiError("Project could not be found.", 404);
      const milestones = ((org.milestones ??= {})[itemId] ??= []);
      if (method === "POST")
        result = saveItem(milestones, undefined, {
          title: String(payload.title),
          dueDate: payload.dueDate as string | null,
          done: false,
        });
      else if (method === "PATCH") {
        const target = milestones.find(
          (milestone) => milestone.id === route.split("/")[5],
        );
        if (!target) throw new ApiError("Milestone could not be found.", 404);
        target.done = Boolean(payload.done);
        result = target;
      } else result = milestones;
    } else if (collection === "projects") {
      const project = saveItem(
        org.projects,
        itemId,
        payload as Omit<Project, "id">,
      );
      record(
        org,
        itemId ? "project.updated" : "project.created",
        project.title,
      );
      if (project.status === "Completed")
        execute(org, "project.completed", project.priority);
      result = project;
    } else if (collection === "tasks" && child === "comments" && itemId) {
      if (!org.tasks.some((task) => task.id === itemId))
        throw new ApiError("Task could not be found.", 404);
      const comments = (org.comments[itemId] ??= []);
      if (method === "POST")
        comments.push({
          id: id(),
          name: state.user.name,
          body: String(payload.body),
          createdAt: timestamp(),
        });
      result = comments;
    } else if (collection === "tasks" && child && itemId) {
      if (!org.tasks.some((task) => task.id === itemId))
        throw new ApiError("Task could not be found.", 404);
      const details = ((org.details ??= {})[itemId] ??= {
        labels: [],
        dependencies: [],
        subtasks: [],
        history: [],
      });
      const childId = decodeURIComponent(route.split("/")[5] ?? "");
      if (child === "subtasks") {
        if (method === "POST")
          result = saveItem(details.subtasks, undefined, {
            title: String(payload.title),
            done: false,
          });
        else {
          const target = details.subtasks.find((item) => item.id === childId);
          if (!target) throw new ApiError("Subtask could not be found.", 404);
          target.done = Boolean(payload.done);
          result = target;
        }
      } else if (child === "dependencies") {
        if (method === "DELETE")
          details.dependencies = details.dependencies.filter(
            (item) => item.id !== childId,
          );
        else {
          const target = org.tasks.find(
            (task) => task.id === payload.prerequisiteId,
          );
          if (!target || target.id === itemId)
            throw new ApiError("Choose another task from this workspace.", 400);
          const pending = [target.id];
          const visited = new Set<string>();
          for (const id of pending) {
            if (id === itemId)
              throw new ApiError("This dependency would create a cycle.", 409);
            if (visited.has(id)) continue;
            visited.add(id);
            pending.push(
              ...(org.details?.[id]?.dependencies ?? []).map((item) => item.id),
            );
          }
          if (!details.dependencies.some((item) => item.id === target.id))
            details.dependencies.push({
              id: target.id,
              title: target.title,
              status: target.status,
            });
          result = target;
        }
      } else if (child === "labels") {
        const name = String(payload.name).trim().toLowerCase();
        if (method === "DELETE")
          details.labels = details.labels.filter((label) => label !== childId);
        else {
          if (!details.labels.includes(name)) details.labels.push(name);
          result = { name };
        }
      } else if (child === "details") result = details;
    } else if (collection === "tasks" && itemId === "bulk") {
      const items = payload.tasks as { id: string; version: number }[];
      for (const item of items) {
        const task = org.tasks.find((task) => task.id === item.id);
        if (!task || task.version !== item.version)
          throw new ApiError("A selected task changed.", 409);
      }
      for (const item of items) {
        const task = org.tasks.find((task) => task.id === item.id)!;
        const next = String(payload.status);
        if (task.status !== "Completed" && next === "Completed")
          execute(org, "task.completed", task.priority);
        Object.assign(task, {
          status: next,
          version: task.version + 1,
          updatedAt: timestamp(),
          completedAt:
            next === "Completed" ? (task.completedAt ?? timestamp()) : null,
        });
        record(org, "task.updated", task.title);
      }
      result = { ok: true };
    } else if (collection === "tasks") {
      const previous = org.tasks.find((task) => task.id === itemId);
      if (previous && previous.version !== payload.version)
        throw new ApiError("This task changed. Reload and try again.", 409);
      const wasComplete = previous?.status === "Completed";
      const status = String(payload.status);
      const task = saveItem(org.tasks, itemId, {
        ...(payload as Omit<Task, "id">),
        version: previous ? previous.version + 1 : 0,
        updatedAt: timestamp(),
        completedAt:
          status === "Completed"
            ? (previous?.completedAt ?? timestamp())
            : null,
      });
      const details = ((org.details ??= {})[task.id] ??= {
        labels: [],
        dependencies: [],
        subtasks: [],
        history: [],
      });
      const action = itemId ? "task.updated" : "task.created";
      details.history.unshift({
        id: id(),
        name: state.user.name,
        action,
        status: task.status,
        createdAt: timestamp(),
      });
      record(org, action, task.title);
      if (!itemId) execute(org, "task.created", task.priority);
      if (!wasComplete && status === "Completed")
        execute(org, "task.completed", task.priority);
      result = task;
    } else if (collection === "rules") {
      result = saveItem(org.rules, itemId, payload as Omit<Rule, "id">);
      record(org, "workflow.saved", (result as Rule).title);
    } else if (collection === "executions") result = org.executions;
    else if (collection === "search") {
      const term = (new URLSearchParams(query).get("q") ?? "").toLowerCase();
      result = org.channels
        .flatMap((channel) =>
          (org.messages[channel.id] ?? [])
            .filter((message) =>
              (message.body + " " + message.author)
                .toLowerCase()
                .includes(term),
            )
            .map((message) => ({
              ...message,
              channel: channel.name,
              channelId: channel.id,
            })),
        )
        .slice(0, 10);
    } else if (collection === "channels" && child === "messages" && itemId) {
      if (!org.channels.some((channel) => channel.id === itemId))
        throw new ApiError("Channel could not be found.", 404);
      const messages = (org.messages[itemId] ??= []);
      const messageId = route.split("/")[5];
      if (messageId) {
        const message = messages.find((item) => item.id === messageId);
        if (!message) throw new ApiError("Message could not be found.", 404);
        if (route.endsWith("/reaction")) {
          const emoji = String(payload.emoji);
          const matches = (message.reactions ??= []);
          const existing = matches.find((item) => item.emoji === emoji);
          if (payload.active && !existing)
            matches.push({ emoji, count: 1, mine: true });
          if (!payload.active)
            message.reactions = matches.filter((item) => item.emoji !== emoji);
        } else {
          if (message.authorId !== state.user.id)
            throw new ApiError("Message could not be found.", 404);
          if (method === "DELETE")
            org.messages[itemId] = messages.filter(
              (item) => item.id !== messageId,
            );
          else {
            message.body = String(payload.body);
            message.editedAt = timestamp();
          }
        }
      } else if (method === "POST")
        messages.push({
          id: id(),
          authorId: state.user.id,
          author: state.user.name,
          body: String(payload.body),
          createdAt: timestamp(),
        });
      result = org.messages[itemId];
    } else if (collection === "channels") {
      if (method === "POST") {
        if (org.channels.some((channel) => channel.name === payload.name))
          throw new ApiError("This channel already exists.", 409);
        result = saveItem(org.channels, undefined, {
          name: String(payload.name),
          kind: (payload.kind as Channel["kind"]) ?? "channel",
        });
      } else result = org.channels;
    } else if (collection === "notification-preferences") {
      if (method === "PATCH") org.emailNotices = Boolean(payload.email);
      result = { email: org.emailNotices ?? false };
    } else if (collection === "notifications") {
      if (method === "PATCH")
        org.notices.forEach((notice) => {
          if (!itemId || notice.id === itemId) notice.read = true;
        });
      result = org.notices;
    } else if (collection === "directory") {
      const directory = (org.directory ??= { departments: [], teams: [] });
      if (method === "POST") {
        if (itemId === "departments")
          result = saveItem(directory.departments, undefined, {
            name: String(payload.name),
          });
        else
          result = saveItem(directory.teams, undefined, {
            name: String(payload.name),
            departmentId: payload.departmentId as string | null,
            memberIds: "[]",
          });
      } else if (method === "PATCH") {
        const target = directory.teams.find((team) => team.id === child);
        if (!target) throw new ApiError("Team could not be found.", 404);
        const members = new Set<string>(JSON.parse(target.memberIds));
        const user = String(payload.userId);
        if (payload.assigned) members.add(user);
        else members.delete(user);
        target.memberIds = JSON.stringify([...members]);
        result = target;
      } else result = directory;
    } else if (collection === "settings") {
      organization.name = String(payload.name);
      result = organization;
    } else if (collection === "billing-provider") {
      result = { provider: "mock" };
    } else if (collection === "billing") {
      organization.plan = String(payload.plan);
      org.invoices.unshift({
        id: id(),
        plan: organization.plan,
        amount: organization.plan === "Professional" ? 2400 : 0,
        createdAt: timestamp(),
      });
      record(org, "subscription.updated", organization.plan);
      result = organization;
    } else if (collection === "invitations") {
      if (method === "GET") result = org.invitations;
      else if (method === "DELETE")
        org.invitations = org.invitations.filter(
          (invite) => invite.id !== itemId,
        );
      else
        result = saveItem(org.invitations, undefined, {
          email: String(payload.email),
          role: String(payload.role),
          expiresAt: dateOffset(7),
        });
    } else if (collection === "members" && itemId) {
      const member = org.team.find((person) => person.id === itemId);
      if (!member) throw new ApiError("Member could not be found.", 404);
      result = saveItem(org.team, itemId, {
        ...member,
        role: String(payload.role),
      });
    }
  }
  if (result === undefined && method !== "DELETE")
    throw new ApiError("This action is unavailable in the local demo.", 404);
  localStorage.setItem(key, JSON.stringify(state));
  return result as T;
}
