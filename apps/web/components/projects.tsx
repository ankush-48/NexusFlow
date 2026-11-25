"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownUp,
  Box,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCheck,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleDot,
  CodeXml,
  Compass,
  CreditCard,
  Fingerprint,
  Folders,
  GanttChart,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquareKanban,
  Target,
  Workflow,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  dateOffset,
  formatDate,
  priorities,
  projectHref,
  statuses,
  tally,
  today,
  type Comment,
  type Person,
  type Project,
  type Snapshot,
  type Task,
} from "../lib/model";
import {
  Avatar,
  Empty,
  Field,
  Modal,
  PersonSelect,
  Priority,
  StatusIcon,
  type Request,
} from "./common";
import { Button } from "./ui/button";
import { Attachments, TaskMetadata } from "./work-details";

const projectIcons = [
  Target,
  Compass,
  CreditCard,
  CodeXml,
  Sparkles,
  Workflow,
  ChartNoAxesCombined,
  Box,
  Fingerprint,
  LayoutGrid,
  Activity,
  Folders,
];
const tones = [
  "iris",
  "sea",
  "gold",
  "sky",
  "iris",
  "sea",
  "sky",
  "rose",
  "sea",
  "rose",
  "iris",
  "gold",
];
const defaultTeams = [
  "Product",
  "Design",
  "Platform",
  "Engineering",
  "Data",
  "Operations",
];
const teamTones: Record<string, string> = {
  Product: "iris",
  Design: "rose",
  Platform: "gold",
  Engineering: "sea",
  Data: "sky",
};
const views = [
  { label: "Board", icon: SquareKanban },
  { label: "List", icon: List },
  { label: "Timeline", icon: GanttChart },
] as const;
type Editor =
  | { kind: "project"; value?: Project; status?: string }
  | { kind: "task"; value?: Task; status?: string; projectId?: string };

export function Projects({
  snapshot,
  manage,
  open,
  initialProject,
  label,
}: {
  snapshot: Snapshot;
  manage: boolean;
  open: (editor: Editor) => void;
  initialProject?: string;
  label: string;
}) {
  const [view, setView] = useState<(typeof views)[number]["label"]>("Board");
  const [term, setTerm] = useState("");
  const [team, setTeam] = useState("");
  const [priority, setPriority] = useState("");
  const [sort, setSort] = useState("default");
  const [showFilters, setShowFilters] = useState(false);
  const [archived, setArchived] = useState(false);
  if (initialProject) return null;
  const teams = [
    ...new Set([
      ...defaultTeams,
      ...(snapshot.teams ?? []),
      ...snapshot.projects.map((project) => project.team),
    ]),
  ];
  const all = snapshot.projects.filter((project) => !project.archived);
  const visible = snapshot.projects
    .filter(
      (project) =>
        project.archived === archived &&
        (!team || project.team === team) &&
        (!priority || project.priority === priority) &&
        (project.title + " " + project.description)
          .toLowerCase()
          .includes(term.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : sort === "due"
          ? (a.dueDate || "9999").localeCompare(b.dueDate || "9999")
          : 0,
    );
  const total = all.length;
  const active = all.filter(
    (project) => project.status === "In progress",
  ).length;
  const finished = all.filter(
    (project) => project.status === "Completed",
  ).length;
  const done = tally(snapshot.tasks);
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <Folders size={14} /> PROJECT MANAGEMENT
          </div>
          <h1>Projects</h1>
          <p>Plan, track, and deliver work across {label}.</p>
        </div>
        {manage && (
          <Button className="primary" onClick={() => open({ kind: "project" })}>
            <Plus size={17} /> New project
          </Button>
        )}
      </section>
      <section className="stats">
        {[
          {
            label: "Total projects",
            value: total,
            icon: Folders,
            tone: "iris",
            detail: "Across all teams",
          },
          {
            label: "In progress",
            value: active,
            icon: CircleDot,
            tone: "sky",
            detail: "Projects underway",
          },
          {
            label: "Completed",
            value: finished,
            icon: CircleCheck,
            tone: "sea",
            detail: "Projects delivered",
          },
          {
            label: "Task completion",
            value:
              (snapshot.tasks.length
                ? Math.round((100 * done.completed) / snapshot.tasks.length)
                : 0) + "%",
            icon: ChartNoAxesCombined,
            tone: "gold",
            detail:
              done.completed + " of " + snapshot.tasks.length + " tasks done",
          },
        ].map((stat) => (
          <div className="stat" key={stat.label}>
            <div className="stat-top">
              <span>{stat.label}</span>
              <span className={"stat-icon tone-" + stat.tone}>
                <stat.icon size={16} />
              </span>
            </div>
            <strong>{stat.value}</strong>
            <span className="muted">{stat.detail}</span>
          </div>
        ))}
      </section>
      <section className="project-views">
        <div className="view-toolbar">
          <div className="tabs" aria-label="Project views">
            {views.map((tab) => (
              <Button
                key={tab.label}
                className={view === tab.label ? "selected" : "ghost"}
                aria-pressed={view === tab.label}
                onClick={() => setView(tab.label)}
              >
                <tab.icon size={16} />
                {tab.label}
              </Button>
            ))}
          </div>
          <div className="view-actions">
            <label className="input-search">
              <Search size={15} />
              <input
                aria-label="Search projects"
                placeholder="Search projects…"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
              />
            </label>
            <Button
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
              className={showFilters ? "selected" : ""}
            >
              <SlidersHorizontal size={15} /> Filter
              {(team || priority || archived) && (
                <span className="filter-dot" />
              )}
            </Button>
            <label className="select-action">
              <ArrowDownUp size={15} />
              <select
                aria-label="Sort projects"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="default">Sort</option>
                <option value="name">Name</option>
                <option value="due">Due date</option>
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
        </div>
        {showFilters && (
          <div className="filter-bar">
            <select
              aria-label="Filter team"
              value={team}
              onChange={(event) => setTeam(event.target.value)}
            >
              <option value="">All teams</option>
              {teams.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Filter priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option value="">All priorities</option>
              {priorities.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={archived}
                onChange={(event) => setArchived(event.target.checked)}
              />{" "}
              Archived projects
            </label>
            <Button
              className="ghost"
              onClick={() => {
                setTeam("");
                setPriority("");
                setArchived(false);
                setTerm("");
              }}
            >
              Clear filters
            </Button>
          </div>
        )}
        {view === "Board" && (
          <div className="board">
            {statuses.map((status, i) => {
              const entries = visible.filter(
                (project) => project.status === status,
              );
              return (
                <section
                  key={status}
                  className={"lane lane-" + i}
                  aria-label={status}
                >
                  <header className="lane-header">
                    <StatusIcon status={status} />
                    <h2>{status}</h2>
                    <span className="lane-count">{entries.length}</span>
                    {manage && (
                      <Button
                        className="icon ghost"
                        aria-label={"Add " + status.toLowerCase() + " project"}
                        onClick={() => open({ kind: "project", status })}
                      >
                        <Plus size={16} />
                      </Button>
                    )}
                  </header>
                  <div className="lane-body">
                    {entries.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        people={snapshot.team}
                        index={snapshot.projects.findIndex(
                          (item) => item.id === project.id,
                        )}
                        manage={manage}
                        open={open}
                      />
                    ))}
                    {entries.length === 0 && (
                      <Empty>No {status.toLowerCase()} projects match.</Empty>
                    )}
                    {manage && !archived && (
                      <Button
                        className="ghost add-card"
                        onClick={() => open({ kind: "project", status })}
                      >
                        <Plus size={15} /> Add project
                      </Button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {view === "List" && (
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th>Team</th>
                  <th>Due date</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={projectHref(project.id)}>
                        {project.title}
                      </Link>
                    </td>
                    <td>
                      <span className="inline">
                        <StatusIcon status={project.status} />
                        {project.status}
                      </span>
                    </td>
                    <td>{project.team}</td>
                    <td>{formatDate(project.dueDate)}</td>
                    <td>{project.progress}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && <Empty>No projects match your filters.</Empty>}
          </div>
        )}
        {view === "Timeline" && <Timeline projects={visible} />}
      </section>
    </>
  );
}

function ProjectCard({
  project,
  index,
  people,
  manage,
  open,
}: {
  project: Project;
  index: number;
  people: Person[];
  manage: boolean;
  open: (editor: Editor) => void;
}) {
  const Icon = projectIcons[index % projectIcons.length];
  const owner = people.find((person) => person.id === project.owner);
  return (
    <motion.article
      className="project-card"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="card-top">
        <span className={"project-icon tone-" + tones[index % tones.length]}>
          <Icon size={18} />
        </span>
        {manage && (
          <Button
            className="icon ghost more"
            aria-label={"Edit " + project.title}
            onClick={() => open({ kind: "project", value: project })}
          >
            <MoreHorizontal size={18} />
          </Button>
        )}
      </div>
      <h3>
        <Link href={projectHref(project.id)}>{project.title}</Link>
      </h3>
      <p>{project.description}</p>
      <div className="card-tags">
        <span
          className={"team-pill tone-" + (teamTones[project.team] || "iris")}
        >
          <span />
          {project.team}
        </span>
        <Priority value={project.priority} />
      </div>
      <div className="card-progress">
        <div className="progress">
          <div style={{ width: project.progress + "%" }} />
        </div>
        <span>{project.progress}%</span>
      </div>
      <footer>
        <span className="inline">
          <CalendarDays size={14} />
          {formatDate(project.dueDate)}
        </span>
        {owner && <Avatar name={owner.name} small />}
      </footer>
    </motion.article>
  );
}

function Timeline({ projects }: { projects: Project[] }) {
  const dated = projects.filter(
    (project) => project.startDate && project.dueDate,
  );
  const from = dated.reduce(
    (min, p) => (String(p.startDate) < min ? String(p.startDate) : min),
    today(),
  );
  const until = dated.reduce(
    (max, p) => (String(p.dueDate) > max ? String(p.dueDate) : max),
    dateOffset(14),
  );
  const width = Math.max(
    new Date(until).getTime() - new Date(from).getTime(),
    1,
  );
  const offset = (date: string) =>
    (100 * (new Date(date).getTime() - new Date(from).getTime())) / width;
  return (
    <div className="panel timeline">
      <div className="timeline-row timeline-head">
        <span>Project</span>
        <div>
          <span>{formatDate(from)}</span>
          <span>{formatDate(until)}</span>
        </div>
      </div>
      {dated.map((project) => (
        <div className="timeline-row" key={project.id}>
          <Link href={projectHref(project.id)}>{project.title}</Link>
          <div className="timeline-track">
            <span
              className={project.status === "Completed" ? "done" : ""}
              title={
                formatDate(project.startDate) +
                " – " +
                formatDate(project.dueDate)
              }
              style={{
                left: offset(project.startDate || from) + "%",
                width:
                  Math.max(
                    1,
                    offset(project.dueDate || from) -
                      offset(project.startDate || from),
                  ) + "%",
              }}
            />
          </div>
        </div>
      ))}
      {dated.length === 0 && (
        <Empty>Add project start and due dates to populate the timeline.</Empty>
      )}
    </div>
  );
}

export function TaskBoard({
  tasks,
  project,
  manage,
  projectManage = manage,
  open,
  move,
  bulk,
  people,
  pending,
}: {
  tasks: Task[];
  project?: Project;
  manage: boolean;
  projectManage?: boolean;
  open: (editor: Editor) => void;
  move: (task: Task, status: string) => void;
  bulk: (tasks: Task[], status: string) => Promise<boolean>;
  people: Person[];
  pending: boolean;
}) {
  const [view, setView] = useState("Board");
  const [query, setQuery] = useState("");
  const [over, setOver] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<string>("Completed");
  const [bulkPending, setBulkPending] = useState(false);
  const dragged = useRef("");
  const filtered = tasks.filter((task) =>
    task.title.toLowerCase().includes(query.toLowerCase()),
  );
  const selection = filtered.filter((task) => checked.includes(task.id));
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <SquareKanban size={14} />{" "}
            {project ? project.team.toUpperCase() : "PERSONAL WORK"}
          </div>
          <h1>{project?.title ?? "My tasks"}</h1>
          <p>
            {project?.description ??
              "Review and update the work assigned to you."}
          </p>
        </div>
        {manage && (
          <div className="inline">
            {project && projectManage && (
              <Button onClick={() => open({ kind: "project", value: project })}>
                Edit project
              </Button>
            )}
            <Button
              className="primary"
              onClick={() => open({ kind: "task", projectId: project?.id })}
            >
              <Plus size={17} /> New task
            </Button>
          </div>
        )}
      </section>
      <div className="view-toolbar task-toolbar">
        <div className="tabs">
          {["Board", "List"].map((label) => (
            <Button
              key={label}
              className={view === label ? "selected" : "ghost"}
              aria-pressed={view === label}
              onClick={() => setView(label)}
            >
              {label === "Board" ? (
                <SquareKanban size={16} />
              ) : (
                <List size={16} />
              )}{" "}
              {label}
            </Button>
          ))}
        </div>
        <label className="input-search">
          <Search size={15} />
          <input
            placeholder="Search tasks…"
            aria-label="Search tasks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {view === "List" && manage && selection.length > 0 && (
        <div className="filter-bar">
          <span>{selection.length} selected</span>
          <select
            aria-label="Bulk task status"
            value={bulkStatus}
            onChange={(event) => setBulkStatus(event.target.value)}
          >
            {statuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <Button
            disabled={bulkPending || selection.length > 50}
            onClick={() => {
              setBulkPending(true);
              void bulk(selection, bulkStatus)
                .then((saved) => {
                  if (saved) setChecked([]);
                })
                .finally(() => setBulkPending(false));
            }}
          >
            Update selected
          </Button>
          <Button className="ghost" onClick={() => setChecked([])}>
            Clear
          </Button>
        </div>
      )}
      {view === "Board" ? (
        <div className="board">
          {statuses.map((status, i) => {
            const matches = filtered.filter((task) => task.status === status);
            return (
              <section
                key={status}
                aria-label={status}
                className={"lane lane-" + i + (over === status ? " over" : "")}
                onDragOver={(event) => {
                  if (manage && !pending && dragged.current) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOver(status);
                  }
                }}
                onDragLeave={(event) => {
                  if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                  )
                    setOver("");
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver("");
                  const task = filtered.find(
                    (task) =>
                      task.id ===
                      (dragged.current ||
                        event.dataTransfer.getData("text/plain")),
                  );
                  dragged.current = "";
                  if (manage && !pending && task && task.status !== status)
                    move(task, status);
                }}
              >
                <header className="lane-header">
                  <StatusIcon status={status} />
                  <h2>{status}</h2>
                  <span className="lane-count">{matches.length}</span>
                  {manage && (
                    <Button
                      className="icon ghost"
                      aria-label={"Add " + status.toLowerCase() + " task"}
                      onClick={() =>
                        open({ kind: "task", status, projectId: project?.id })
                      }
                    >
                      <Plus size={16} />
                    </Button>
                  )}
                </header>
                <div className="lane-body">
                  {matches.map((task) => (
                    <article
                      key={task.id}
                      className="task-card"
                      draggable={manage && !pending}
                      onDragStart={(event) => {
                        dragged.current = task.id;
                        event.dataTransfer.setData("text/plain", task.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        dragged.current = "";
                        setOver("");
                      }}
                    >
                      <button
                        className="text-button task-title"
                        onClick={() => open({ kind: "task", value: task })}
                      >
                        {task.title}
                      </button>
                      <p>{task.description}</p>
                      <div>
                        <Priority value={task.priority} />
                        <span className="muted inline">
                          <CalendarDays size={14} />
                          {formatDate(task.dueDate)}
                        </span>
                        {task.assignee && (
                          <Avatar
                            name={
                              people.find(
                                (person) => person.id === task.assignee,
                              )?.name ?? "Unassigned"
                            }
                            small
                          />
                        )}
                      </div>
                    </article>
                  ))}
                  {matches.length === 0 && (
                    <Empty>No tasks in this status.</Empty>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                {manage && <th>Selection</th>}
                <th>Task</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <tr key={task.id}>
                  {manage && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={"Select " + task.title}
                        checked={checked.includes(task.id)}
                        onChange={(event) =>
                          setChecked(
                            event.target.checked
                              ? [...checked, task.id]
                              : checked.filter((id) => id !== task.id),
                          )
                        }
                      />
                    </td>
                  )}
                  <td>
                    <button
                      className="text-button"
                      onClick={() => open({ kind: "task", value: task })}
                    >
                      {task.title}
                    </button>
                  </td>
                  <td className="inline">
                    <StatusIcon status={task.status} />
                    {task.status}
                  </td>
                  <td>
                    <Priority value={task.priority} />
                  </td>
                  <td>{formatDate(task.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <Empty>No tasks match.</Empty>}
        </div>
      )}
    </>
  );
}

type FormValues = {
  title: string;
  description: string;
  status: string;
  priority: string;
  team: string;
  startDate: string;
  dueDate: string;
  owner: string;
  assignee: string;
  projectId: string;
  archived: boolean;
};
export function RecordEditor({
  editor,
  snapshot,
  save,
  close,
  request,
  orgId,
  manage,
  demo,
}: {
  editor: Editor;
  snapshot: Snapshot;
  save: (values: FormValues) => Promise<void>;
  close: () => void;
  request: Request;
  orgId: string;
  manage: boolean;
  demo: boolean;
}) {
  const teams = [
    ...new Set([
      ...defaultTeams,
      ...(snapshot.teams ?? []),
      ...snapshot.projects.map((project) => project.team),
    ]),
  ];
  const value = editor.value;
  const project = editor.kind === "project" ? editor.value : undefined;
  const task = editor.kind === "task" ? editor.value : undefined;
  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      title: value?.title ?? "",
      description: value?.description ?? "",
      status: value?.status ?? editor.status ?? "Planned",
      priority: value?.priority ?? "Medium",
      team: project?.team || "Product",
      startDate: project?.startDate ?? "",
      dueDate: value?.dueDate ?? "",
      owner: project?.owner ?? "",
      assignee: task?.assignee ?? "",
      projectId:
        task?.projectId ??
        (editor.kind === "task"
          ? (editor.projectId ??
            snapshot.projects.find((project) => !project.archived)?.id ??
            "")
          : ""),
      archived: project?.archived ?? false,
    },
  });
  const [owner, assignee, startDate] = useWatch({
    control,
    name: ["owner", "assignee", "startDate"],
  });
  const endpoint = "orgs/" + orgId + "/tasks/" + task?.id + "/comments";
  const comments = useQuery({
    queryKey: [endpoint],
    queryFn: () => request<Comment[]>(endpoint),
    enabled: !!task,
  });
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState("");
  const [posting, setPosting] = useState(false);
  const [saveError, setSaveError] = useState("");
  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    setPosting(true);
    setCommentError("");
    try {
      await request(endpoint, "POST", { body: comment.trim() });
      setComment("");
      await comments.refetch();
    } catch (error) {
      setCommentError(
        error instanceof Error ? error.message : "Could not post comment.",
      );
    } finally {
      setPosting(false);
    }
  }
  const selectable = useMemo(
    () =>
      snapshot.projects.filter(
        (project) => !project.archived || project.id === task?.projectId,
      ),
    [snapshot.projects, task?.projectId],
  );
  return (
    <Modal
      title={(value ? (manage ? "Edit " : "View ") : "New ") + editor.kind}
      close={close}
    >
      <form
        className="form"
        onSubmit={handleSubmit(async (values) => {
          setSaveError("");
          try {
            await save(values);
          } catch (error) {
            setSaveError(
              error instanceof Error ? error.message : "Save failed.",
            );
          }
        })}
      >
        <fieldset disabled={!manage || isSubmitting}>
          <Field label="Title">
            <input
              autoFocus
              {...register("title", {
                required: "Enter a title.",
                maxLength: 120,
                validate: (value) => !!value.trim() || "Enter a title.",
              })}
              maxLength={120}
            />
          </Field>
          {errors.title && (
            <span className="form-error">{errors.title.message}</span>
          )}
          <Field label="Description">
            <textarea {...register("description")} rows={3} maxLength={2000} />
          </Field>
          <div className="form-grid">
            <Field label="Status">
              <select {...register("status")}>
                {statuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select {...register("priority")}>
                {priorities.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </Field>
          </div>
          {editor.kind === "project" ? (
            <>
              <div className="form-grid">
                <Field label="Team">
                  <select {...register("team")}>
                    {teams.map((team) => (
                      <option key={team}>{team}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Owner">
                  <PersonSelect
                    label="Owner"
                    people={snapshot.team}
                    value={owner}
                    onChange={(value) => setValue("owner", value)}
                  />
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Start date">
                  <input type="date" {...register("startDate")} />
                </Field>
                <Field label="Due date">
                  <input
                    type="date"
                    min={startDate || undefined}
                    {...register("dueDate")}
                  />
                </Field>
              </div>
              {project && (
                <label className="inline">
                  <input type="checkbox" {...register("archived")} /> Archive
                  project
                </label>
              )}
            </>
          ) : (
            <>
              <Field label="Project">
                <select {...register("projectId", { required: true })} required>
                  <option value="" disabled>
                    Choose project
                  </option>
                  {selectable.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="form-grid">
                <Field label="Assignee">
                  <PersonSelect
                    label="Assignee"
                    people={snapshot.team}
                    value={assignee}
                    onChange={(value) => setValue("assignee", value)}
                  />
                </Field>
                <Field label="Due date">
                  <input type="date" {...register("dueDate")} />
                </Field>
              </div>
            </>
          )}
        </fieldset>
        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="form-actions">
          <Button onClick={close}>{manage ? "Cancel" : "Close"}</Button>
          {manage && (
            <Button
              type="submit"
              className="primary"
              disabled={
                isSubmitting || (editor.kind === "task" && !selectable.length)
              }
            >
              {isSubmitting
                ? "Saving…"
                : value
                  ? "Save changes"
                  : "Create " + editor.kind}
            </Button>
          )}
        </div>
      </form>
      {task && !demo && (
        <Attachments
          path={"orgs/" + orgId + "/tasks/" + task.id + "/attachments"}
          request={request}
          manage={manage}
        />
      )}
      {task && (
        <TaskMetadata
          task={task}
          tasks={snapshot.tasks}
          base={"orgs/" + orgId}
          request={request}
          manage={manage}
        />
      )}
      {task && (
        <section className="comments">
          <h3>Comments</h3>
          {comments.isError && (
            <p className="form-error">Comments could not be loaded.</p>
          )}
          {comments.data?.map((item) => (
            <div className="comment" key={item.id}>
              <Avatar name={item.name} small />
              <div>
                <strong>{item.name}</strong>
                <p>{item.body}</p>
              </div>
            </div>
          ))}
          {manage && (
            <form className="inline" onSubmit={addComment}>
              <input
                aria-label="Comment"
                placeholder="Add a comment…"
                value={comment}
                maxLength={2000}
                onChange={(event) => setComment(event.target.value)}
              />
              <Button type="submit" disabled={!comment.trim() || posting}>
                Post
              </Button>
            </form>
          )}
          {commentError && <p className="form-error">{commentError}</p>}
        </section>
      )}
    </Modal>
  );
}

export function CalendarView({
  tasks,
  open,
}: {
  tasks: Task[];
  open: (editor: Editor) => void;
}) {
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const start = new Date(month + "-01T00:00:00Z");
  const calendarStart = new Date(start);
  calendarStart.setUTCDate(1 - ((start.getUTCDay() + 6) % 7));
  const change = (step: number) => {
    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + step);
    setMonth(next.toISOString().slice(0, 7));
  };
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <CalendarDays size={14} /> SCHEDULE
          </div>
          <h1>Calendar</h1>
          <p>See the work due across your workspace.</p>
        </div>
        <div className="inline">
          <Button onClick={() => change(-1)}>Previous</Button>
          <Button onClick={() => setMonth(today().slice(0, 7))}>Today</Button>
          <Button onClick={() => change(1)}>Next</Button>
        </div>
      </section>
      <div className="panel calendar">
        <h2>
          {formatDate(start.toISOString(), { month: "long", year: "numeric" })}
        </h2>
        <div className="calendar-grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div className="weekday" key={day}>
              {day}
            </div>
          ))}
          {Array.from({ length: 42 }, (_, index) => {
            const date = new Date(calendarStart);
            date.setUTCDate(date.getUTCDate() + index);
            const day = date.toISOString().slice(0, 10);
            return (
              <div
                key={day}
                className={
                  "calendar-day" +
                  (day.startsWith(month) ? "" : " outside") +
                  (day === today() ? " current" : "")
                }
              >
                <span>{date.getUTCDate()}</span>
                {tasks
                  .filter((task) => task.dueDate === day)
                  .map((task) => (
                    <button
                      key={task.id}
                      className="calendar-task"
                      onClick={() => open({ kind: "task", value: task })}
                    >
                      {task.status === "Completed" ? (
                        <CheckCheck size={13} />
                      ) : (
                        <Circle size={11} />
                      )}{" "}
                      {task.title}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export type { Editor, FormValues };
