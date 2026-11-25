"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import { openWorkspaceSocket } from "../lib/live-socket";
import {
  Bell,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  Clock,
  Hash,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import {
  formatDate,
  priorities,
  triggers,
  type Channel,
  type Execution,
  type Message,
  type Notice,
  type Person,
  type Project,
  type Rule,
} from "../lib/model";
import {
  Avatar,
  Empty,
  errorText,
  Field,
  Modal,
  type Notify,
  type Request,
} from "./common";
import { Button } from "./ui/button";

const triggerLabels: Record<string, string> = {
  "task.created": "Task created",
  "task.completed": "Task completed",
  "task.overdue": "Task becomes overdue",
  "task.due_soon": "Task deadline approaches",
  "project.completed": "Project completed",
  "member.joined": "New member joins",
};

export function Messages({
  orgId,
  request,
  notify,
  demo,
  contribute,
  user,
  people,
  projects,
}: {
  orgId: string;
  request: Request;
  notify: Notify;
  demo: boolean;
  contribute: boolean;
  user: Person;
  people: Person[];
  projects: Project[];
}) {
  const client = useQueryClient();
  const [channelId, setChannelId] = useState("");
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<NonNullable<Channel["kind"]>>("channel");
  const [members, setMembers] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [typing, setTyping] = useState("");
  const [online, setOnline] = useState<number | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const socketRef = useRef<Socket | null>(null);
  const [channelName, setChannelName] = useState("");
  const [pending, setPending] = useState(false);
  const [connection, setConnection] = useState("Connecting");
  const base = "collab/" + orgId + "/channels";
  const channels = useQuery({
    queryKey: [base],
    queryFn: () => request<Channel[]>(base),
  });
  const urlChannel = useSearchParams().get("channel");
  const channel =
    channels.data?.find((item) => item.id === (channelId || urlChannel)) ??
    channels.data?.[0];
  const activeChannel = channel?.id;
  const path = base + "/" + activeChannel + "/messages";
  const messages = useQuery({
    queryKey: [path],
    queryFn: () => request<Message[]>(path),
    enabled: !!channel,
    refetchInterval: demo ? false : 20000,
  });
  useEffect(() => {
    if (demo || !activeChannel) return;
    const { socket, close } = openWorkspaceSocket(
      () => request("orgs/" + orgId + "/membership"),
      () => setConnection("Unavailable"),
    );
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("workspace.join", orgId, () => {});
      socket.emit(
        "channel.join",
        { orgId, channelId: activeChannel },
        (result: { ok: boolean }) =>
          setConnection(result.ok ? "Live" : "Unavailable"),
      );
    });
    socket.on("workspace.presence", (data: { online: string[] }) =>
      setOnline(data.online.length),
    );
    socket.on("disconnect", () => {
      setConnection("Reconnecting");
      setOnline(null);
    });
    socket.on("connect_error", () => setConnection("Reconnecting"));
    socket.on("message.created", () => {
      void client.invalidateQueries({ queryKey: [path] });
      void client.invalidateQueries({ queryKey: [base] });
    });
    socket.on("channel.typing", (name: string) => {
      setTyping(name);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(""), 2200);
    });
    return () => {
      socketRef.current = null;
      close();
      clearTimeout(typingTimer.current);
    };
  }, [activeChannel, base, client, demo, orgId, path, request]);

  const newest = messages.data?.at(-1)?.id;
  const readPath = channel ? base + "/" + channel.id + "/read" : "";
  useEffect(() => {
    if (demo || !readPath || !newest) return;
    void request(readPath, "PATCH")
      .then(() => client.invalidateQueries({ queryKey: [base] }))
      .catch(() => {});
  }, [base, client, demo, newest, readPath, request]);

  async function updateMessage(
    message: Message,
    method: string,
    data?: unknown,
    suffix = "",
  ) {
    setPending(true);
    try {
      await request(path + "/" + message.id + suffix, method, data);
      await messages.refetch();
      setEditing(null);
      setDeleting(null);
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setPending(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || !channel) return;
    setPending(true);
    try {
      await request(path, "POST", { body: body.trim() });
      setBody("");
      await messages.refetch();
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setPending(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const added = await request<Channel>(base, "POST", {
        name: channelName.trim().toLowerCase(),
        kind,
        members,
        projectId: kind === "project" ? projectId : undefined,
      });
      await channels.refetch();
      setChannelId(added.id);
      setCreating(false);
      setChannelName("");
      setKind("channel");
      setProjectId("");
      setMembers([]);
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setPending(false);
    }
  }
  const visible =
    messages.data?.filter((message) =>
      (message.body + " " + message.author)
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <MessageSquare size={14} /> COLLABORATION
          </div>
          <h1>Messages</h1>
          <p>Keep conversations and decisions close to the work.</p>
        </div>
      </section>
      <section className="panel message-shell">
        <aside>
          <div className="message-side-head">
            <h2>Channels</h2>
            {contribute && (
              <Button
                className="icon ghost"
                aria-label="Create channel"
                onClick={() => setCreating(true)}
              >
                <Plus size={16} />
              </Button>
            )}
          </div>
          {channels.isError && <Empty>Channels could not be loaded.</Empty>}
          {channels.data?.map((item) => (
            <Button
              key={item.id}
              className={item.id === channel?.id ? "selected" : "ghost"}
              onClick={() => {
                setChannelId(item.id);
                setQuery("");
                setBody("");
                setTyping("");
              }}
            >
              {item.kind === "direct" || item.kind === "group" ? (
                <Users size={16} />
              ) : (
                <Hash size={16} />
              )}
              <span>{item.name}</span>
              {!!item.unread && (
                <small className="lane-count">{item.unread}</small>
              )}
            </Button>
          ))}
        </aside>
        <div className="message-main">
          {channel ? (
            <>
              <header>
                <div className="inline">
                  {channel.kind === "direct" || channel.kind === "group" ? (
                    <Users size={19} />
                  ) : (
                    <Hash size={19} />
                  )}
                  <h2>{channel.name}</h2>
                  {!demo && (
                    <span className="live-state">
                      <CircleDot size={12} />
                      {connection}
                      {online !== null ? " · " + online + " online" : ""}
                    </span>
                  )}
                </div>
                <label className="input-search">
                  <Search size={15} />
                  <input
                    aria-label="Search messages in channel"
                    placeholder="Search messages…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </header>
              <div className="message-list" aria-live="polite">
                {messages.isPending && <Empty>Loading messages…</Empty>}
                {messages.isError && (
                  <Empty>Messages could not be loaded.</Empty>
                )}
                {messages.data && !visible.length && (
                  <Empty>
                    {query
                      ? "No matching messages."
                      : "This is the beginning of the channel."}
                  </Empty>
                )}
                {visible.map((message) => (
                  <article key={message.id} className="message">
                    <Avatar name={message.author} />
                    <div>
                      <strong>{message.author}</strong>
                      <time dateTime={message.createdAt}>
                        {formatDate(message.createdAt, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                      <p>{message.body}</p>
                      {message.editedAt && (
                        <small className="muted">Edited</small>
                      )}
                      {message.authorId === user.id && !!message.readCount && (
                        <small className="muted">
                          {" "}
                          · Seen by {message.readCount}
                        </small>
                      )}
                      {contribute && (
                        <div className="message-controls">
                          {["👍", "❤️", "🎉"].map((emoji) => {
                            const reaction = message.reactions?.find(
                              (item) => item.emoji === emoji,
                            );
                            return (
                              <Button
                                className={
                                  reaction?.mine ? "selected" : "ghost"
                                }
                                aria-pressed={!!reaction?.mine}
                                aria-label={"React " + emoji}
                                disabled={pending}
                                key={emoji}
                                onClick={() =>
                                  void updateMessage(
                                    message,
                                    "PATCH",
                                    { emoji, active: !reaction?.mine },
                                    "/reaction",
                                  )
                                }
                              >
                                {emoji}
                                {reaction?.count || ""}
                              </Button>
                            );
                          })}
                          {message.authorId === user.id && (
                            <>
                              <Button
                                className="icon ghost"
                                aria-label="Edit message"
                                onClick={() => setEditing(message)}
                              >
                                <Pencil size={13} />
                              </Button>
                              <Button
                                className="icon ghost"
                                aria-label="Delete message"
                                onClick={() => setDeleting(message)}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {typing && (
                <div className="typing-status" aria-live="polite">
                  {typing} is typing…
                </div>
              )}
              {contribute && (
                <form className="composer" onSubmit={send}>
                  <input
                    maxLength={4000}
                    aria-label="Message"
                    placeholder={"Message #" + channel.name}
                    value={body}
                    onChange={(event) => {
                      setBody(event.target.value);
                      socketRef.current?.emit("channel.typing");
                    }}
                  />
                  <Button
                    className="primary"
                    type="submit"
                    disabled={!body.trim() || pending}
                    aria-label="Send message"
                  >
                    <Send size={16} />
                  </Button>
                </form>
              )}
            </>
          ) : (
            <Empty>
              {channels.isPending
                ? "Loading channels…"
                : "Create a channel to start a conversation."}
            </Empty>
          )}
        </div>
      </section>
      {editing && (
        <Modal title="Edit message" close={() => setEditing(null)}>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              if (editing.body.trim())
                void updateMessage(editing, "PATCH", { body: editing.body });
            }}
          >
            <Field label="Message">
              <textarea
                value={editing.body}
                maxLength={4000}
                rows={4}
                onChange={(event) =>
                  setEditing({ ...editing, body: event.target.value })
                }
              />
            </Field>
            <Button
              className="primary"
              type="submit"
              disabled={pending || !editing.body.trim()}
            >
              Save message
            </Button>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete message?" close={() => setDeleting(null)}>
          <p>This removes your message from the conversation.</p>
          <div className="form-actions">
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              className="primary"
              disabled={pending}
              onClick={() => void updateMessage(deleting, "DELETE")}
            >
              Delete message
            </Button>
          </div>
        </Modal>
      )}
      {creating && (
        <Modal title="Create conversation" close={() => setCreating(false)}>
          <form className="form" onSubmit={create}>
            <Field label="Conversation type">
              <select
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as NonNullable<Channel["kind"]>);
                  setMembers([]);
                }}
              >
                <option value="channel">Workspace channel</option>
                <option value="project">Project channel</option>
                <option value="direct">Direct message</option>
                <option value="group">Group message</option>
              </select>
            </Field>
            {kind === "project" && (
              <Field label="Project">
                <select
                  required
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">Choose a project</option>
                  {projects
                    .filter((project) => !project.archived)
                    .map((project) => (
                      <option value={project.id} key={project.id}>
                        {project.title}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {(kind === "direct" || kind === "group") && (
              <Field label="Participants">
                <select
                  required
                  multiple={kind === "group"}
                  value={kind === "group" ? members : (members[0] ?? "")}
                  onChange={(event) =>
                    setMembers(
                      Array.from(
                        event.target.selectedOptions,
                        (option) => option.value,
                      ).filter(Boolean),
                    )
                  }
                >
                  {kind === "direct" && (
                    <option value="">Choose a member</option>
                  )}
                  {people
                    .filter((person) => person.id !== user.id)
                    .map((person) => (
                      <option value={person.id} key={person.id}>
                        {person.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="Conversation name">
              <input
                required
                pattern="[a-z0-9][a-z0-9-]{1,39}"
                placeholder="project-updates"
                value={channelName}
                onChange={(event) => setChannelName(event.target.value)}
              />
            </Field>
            <div className="form-actions">
              <Button type="submit" className="primary" disabled={pending}>
                Create channel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

const newRule = (): Rule => ({
  id: "",
  title: "",
  trigger: "task.completed",
  priority: "Any",
  message: "",
  active: true,
});

export function Workflows({
  rules,
  orgId,
  request,
  notify,
  refresh,
  manage,
}: {
  rules: Rule[];
  orgId: string;
  request: Request;
  notify: Notify;
  refresh: () => Promise<void>;
  manage: boolean;
}) {
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<Rule | null>(null);
  const [tab, setTab] = useState<"Builder" | "Executions">("Builder");
  const [node, setNode] = useState("Trigger");
  const [pending, setPending] = useState(false);
  const executionsPath = "orgs/" + orgId + "/executions";
  const executions = useQuery({
    queryKey: [executionsPath],
    queryFn: () => request<Execution[]>(executionsPath),
    enabled: tab === "Executions",
    refetchInterval: tab === "Executions" ? 5000 : false,
  });
  const current =
    draft ?? rules.find((rule) => rule.id === selected) ?? rules[0] ?? null;
  const edit = (values: Partial<Rule>) => {
    if (current) setDraft({ ...current, ...values });
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    setPending(true);
    try {
      const result = await request<{ id: string }>(
        "orgs/" + orgId + "/rules" + (current.id ? "/" + current.id : ""),
        current.id ? "PATCH" : "POST",
        current,
      );
      await refresh();
      setSelected(result.id);
      setDraft(null);
      notify("Workflow saved");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setPending(false);
    }
  }
  const stages = [
    {
      title: "Trigger",
      detail: current ? triggerLabels[current.trigger] : "Choose an event",
      icon: Zap,
      tone: "iris",
    },
    {
      title: "Condition",
      detail:
        current?.priority === "Any"
          ? "Any priority"
          : (current?.priority ?? "Choose a filter"),
      icon: Braces,
      tone: "gold",
    },
    { title: "Action", detail: "Send a notification", icon: Bell, tone: "sea" },
  ];
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <Workflow size={14} /> AUTOMATION
          </div>
          <h1>Workflows</h1>
          <p>Turn workspace events into repeatable actions.</p>
        </div>
        {manage && (
          <Button
            className="primary"
            onClick={() => {
              setDraft(newRule());
              setTab("Builder");
              setNode("Trigger");
            }}
          >
            <Plus size={17} /> New workflow
          </Button>
        )}
      </section>
      <div className="view-toolbar">
        <div className="tabs">
          {(["Builder", "Executions"] as const).map((item) => (
            <Button
              key={item}
              className={tab === item ? "selected" : "ghost"}
              aria-pressed={tab === item}
              onClick={() => setTab(item)}
            >
              {item === "Builder" ? (
                <Workflow size={16} />
              ) : (
                <Clock size={16} />
              )}{" "}
              {item}
            </Button>
          ))}
        </div>
      </div>
      {tab === "Builder" ? (
        <section className="panel workflow-shell">
          <aside>
            <h2>Workflows</h2>
            {rules.map((rule) => (
              <Button
                className={current?.id === rule.id ? "selected" : "ghost"}
                key={rule.id}
                onClick={() => {
                  setSelected(rule.id);
                  setDraft(null);
                  setNode("Trigger");
                }}
              >
                <span
                  className={"status-dot " + (rule.active ? "green" : "muted")}
                />
                {rule.title}
              </Button>
            ))}
          </aside>
          {current ? (
            <>
              <div className="canvas">
                <header>
                  <h2>{current.title || "Untitled workflow"}</h2>
                  <span
                    className={
                      "team-pill tone-" + (current.active ? "sea" : "gold")
                    }
                  >
                    {current.active ? "Active" : "Paused"}
                  </span>
                </header>
                <div className="nodes">
                  {stages.map((stage, i) => (
                    <div className="node-row" key={stage.title}>
                      <Button
                        className={
                          "node " + (stage.title === node ? "chosen" : "")
                        }
                        aria-pressed={stage.title === node}
                        onClick={() => setNode(stage.title)}
                      >
                        <span className={"project-icon tone-" + stage.tone}>
                          <stage.icon size={20} />
                        </span>
                        <span>
                          <strong>{stage.title}</strong>
                          <small>{stage.detail}</small>
                        </span>
                        <ChevronRight size={15} />
                      </Button>
                      {i < stages.length - 1 && <div className="connector" />}
                    </div>
                  ))}
                </div>
              </div>
              <form className="node-config form" onSubmit={save}>
                <h2>Configuration</h2>
                <fieldset disabled={!manage || pending}>
                  <Field label="Workflow name">
                    <input
                      required
                      maxLength={120}
                      value={current.title}
                      onChange={(event) => edit({ title: event.target.value })}
                    />
                  </Field>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={current.active}
                      onChange={(event) =>
                        edit({ active: event.target.checked })
                      }
                    />{" "}
                    Workflow enabled
                  </label>
                  {node === "Trigger" && (
                    <Field label="Event">
                      <select
                        value={current.trigger}
                        onChange={(event) =>
                          edit({ trigger: event.target.value })
                        }
                      >
                        {triggers.map((trigger) => (
                          <option key={trigger} value={trigger}>
                            {triggerLabels[trigger]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {node === "Condition" && (
                    <Field label="Priority">
                      <select
                        value={current.priority}
                        onChange={(event) =>
                          edit({ priority: event.target.value })
                        }
                      >
                        {["Any", ...priorities].map((priority) => (
                          <option key={priority}>{priority}</option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {node === "Action" && (
                    <Field label="Notification text">
                      <textarea
                        required
                        maxLength={500}
                        rows={4}
                        value={current.message}
                        onChange={(event) =>
                          edit({ message: event.target.value })
                        }
                      />
                    </Field>
                  )}
                </fieldset>
                {manage && (
                  <Button
                    className="primary"
                    type="submit"
                    disabled={
                      !current.title.trim() ||
                      !current.message.trim() ||
                      pending
                    }
                  >
                    <Check size={16} /> Save workflow
                  </Button>
                )}
              </form>
            </>
          ) : (
            <Empty>Create a workflow to start building.</Empty>
          )}
        </section>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {executions.data?.map((execution) => (
                <tr key={execution.id}>
                  <td>{execution.title}</td>
                  <td>{execution.status}</td>
                  <td>
                    {formatDate(execution.createdAt, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!executions.data?.length && (
            <Empty>
              {executions.isPending
                ? "Loading executions…"
                : executions.isError
                  ? "Executions could not be loaded."
                  : "Executions will appear after a matching event."}
            </Empty>
          )}
        </div>
      )}
    </>
  );
}

export function Notifications({
  orgId,
  request,
  notify,
}: {
  orgId: string;
  request: Request;
  notify: Notify;
}) {
  const path = "collab/" + orgId + "/notifications";
  const preferencesPath = "collab/" + orgId + "/notification-preferences";
  const preferences = useQuery({
    queryKey: [preferencesPath],
    queryFn: () => request<{ email: boolean }>(preferencesPath),
  });
  async function selectEmail(email: boolean) {
    try {
      await request(preferencesPath, "PATCH", { email });
      await preferences.refetch();
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  const notifications = useQuery({
    queryKey: [path],
    queryFn: () => request<Notice[]>(path),
    refetchInterval: 10000,
  });
  async function mark(id?: string) {
    try {
      await request(path + (id ? "/" + id : ""), "PATCH");
      await notifications.refetch();
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <Bell size={14} /> INBOX
          </div>
          <h1>Notifications</h1>
          <p>Catch up on changes that need your attention.</p>
        </div>
        <Button
          disabled={!notifications.data?.some((item) => !item.read)}
          onClick={() => void mark()}
        >
          <Check size={16} /> Mark all read
        </Button>
      </section>
      <div className="panel section-panel">
        <label className="inline">
          <input
            type="checkbox"
            checked={preferences.data?.email ?? false}
            disabled={!preferences.data}
            onChange={(event) => void selectEmail(event.target.checked)}
          />{" "}
          Also send workflow notifications by email
        </label>
      </div>
      <div className="panel section-panel">
        <div className="record-list">
          {notifications.data?.map((item) => (
            <div key={item.id} className="record">
              <span
                className={"project-icon tone-" + (item.read ? "sky" : "iris")}
              >
                <Bell size={16} />
              </span>
              <div>
                <strong>
                  {item.href ? (
                    <Link href={item.href}>{item.title}</Link>
                  ) : (
                    item.title
                  )}
                </strong>
                <small>{formatDate(item.createdAt)}</small>
              </div>
              {!item.read && (
                <Button className="ghost" onClick={() => void mark(item.id)}>
                  Mark read
                </Button>
              )}
            </div>
          ))}
          {!notifications.data?.length && (
            <Empty>
              {notifications.isError
                ? "Notifications could not be loaded."
                : notifications.isPending
                  ? "Loading notifications…"
                  : "You’re all caught up."}
            </Empty>
          )}
        </div>
      </div>
    </>
  );
}
