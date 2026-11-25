"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { create } from "zustand";
import { openWorkspaceSocket } from "../lib/live-socket";
import {
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  Command,
  CreditCard,
  Folders,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Shield,
  Sun,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { demoApi } from "../lib/demo";
import { projectHref, staticDemo } from "../lib/model";
import type { Notice, Org, Person, Screen, Snapshot, Task } from "../lib/model";
import { Avatar, Empty, errorText, Modal, type Request } from "./common";
import {
  CalendarView,
  Projects,
  RecordEditor,
  TaskBoard,
  type Editor,
  type FormValues,
} from "./projects";
import { Messages, Notifications, Workflows } from "./collaboration";
import {
  AdminView,
  AuditView,
  Billing,
  Onboarding,
  SettingsView,
  Team,
} from "./management";
import { Brand, PublicPage } from "./public";
import { Milestones } from "./work-details";
import { Button } from "./ui/button";

const Reports = dynamic(() =>
  import("./reports").then((module) => module.Reports),
);

const menu = [
  {
    name: "Workspace",
    links: [
      { title: "Overview", id: "overview", icon: LayoutDashboard },
      { title: "Projects", id: "projects", icon: Folders },
      { title: "My tasks", id: "tasks", icon: ListChecks },
      { title: "Calendar", id: "calendar", icon: CalendarDays },
    ],
  },
  {
    name: "Collaboration",
    links: [
      { title: "Messages", id: "messages", icon: MessageSquare },
      { title: "Workflows", id: "workflows", icon: Workflow },
      { title: "Analytics", id: "analytics", icon: ChartNoAxesCombined },
      { title: "Team", id: "team", icon: Users },
    ],
  },
  {
    name: "Manage",
    links: [
      { title: "Settings", id: "settings", icon: Settings },
      { title: "Billing", id: "billing", icon: CreditCard },
      { title: "Audit logs", id: "audit", icon: History },
      { title: "Administration", id: "admin", icon: Shield },
    ],
  },
];
const publicScreens = [
  "home",
  "pricing",
  "login",
  "register",
  "forgot-password",
];
const labels = Object.fromEntries(
  menu.flatMap((group) => group.links.map((link) => [link.id, link.title])),
);
const useShell = create<{ collapsed: boolean; flip: () => void }>((set) => ({
  collapsed: false,
  flip: () => set((state) => ({ collapsed: !state.collapsed })),
}));
let refreshing: Promise<void> | undefined;
const liveRequest: Request = async <T,>(
  path: string,
  method?: string,
  data?: unknown,
) => {
  try {
    return await api<T>(path, method, data);
  } catch (error) {
    const mayRefresh =
      path === "auth/me" ||
      !path.startsWith("auth/") ||
      path === "auth/profile" ||
      path.startsWith("auth/sessions") ||
      path === "auth/logout";
    if (!(error instanceof ApiError) || error.status !== 401 || !mayRefresh)
      throw error;
    refreshing ??= api<void>("auth/refresh", "POST").finally(() => {
      refreshing = undefined;
    });
    try {
      await refreshing;
    } catch {
      throw error;
    }
    return api<T>(path, method, data);
  }
};
type Account = Person & { platformAdmin?: boolean };
type MessageMatch = {
  id: string;
  channelId: string;
  channel: string;
  author: string;
  body: string;
};

export function StaticDemoWorkspace({ screen }: { screen: Screen }) {
  const query = useSearchParams();
  return <Workspace screen={screen} projectId={screen === "projects" ? query.get("project") ?? undefined : undefined} demo />;
}

export function Workspace({
  screen,
  projectId,
  demo,
}: {
  screen: Screen;
  projectId?: string;
  demo: boolean;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 12000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <WorkspaceBody screen={screen} projectId={projectId} demo={demo} />
    </QueryClientProvider>
  );
}

function WorkspaceBody({
  screen,
  projectId,
  demo,
}: {
  screen: Screen;
  projectId?: string;
  demo: boolean;
}) {
  const request = demo ? demoApi : liveRequest;
  const router = useRouter();
  const client = useQueryClient();
  const isPublic = publicScreens.includes(screen);
  const [selected, setSelected] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (localStorage.getItem("nexusflow-org-" + demo) ?? ""),
  );
  const [expanded, setExpanded] = useState("");
  const [mobile, setMobile] = useState(false);
  const [palette, setPalette] = useState(false);
  const [demoGuide, setDemoGuide] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [light, setLight] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("nexusflow-theme") === "light",
  );
  const { collapsed, flip } = useShell();
  const user = useQuery({
    queryKey: ["auth/me", demo],
    queryFn: () => request<Account>("auth/me"),
    enabled: !isPublic,
    refetchOnWindowFocus: true,
  });
  const list = useQuery({
    queryKey: ["orgs", demo],
    queryFn: () => request<Org[]>("orgs"),
    enabled: !!user.data && !isPublic,
  });
  const org = list.data?.find((org) => org.id === selected) ?? list.data?.[0];
  const base = "orgs/" + org?.id;
  const snapshot = useQuery({
    queryKey: [base, "snapshot"],
    queryFn: () => request<Snapshot>(base + "/snapshot"),
    enabled: !!org && !isPublic && screen !== "onboarding",
  });
  const notices = useQuery({
    queryKey: ["collab/" + org?.id + "/notifications"],
    queryFn: () => request<Notice[]>("collab/" + org?.id + "/notifications"),
    enabled: !!org && !isPublic && screen !== "onboarding",
    refetchInterval: 20000,
  });
  const unseen = notices.data?.filter((item) => !item.read).length ?? 0;
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
  }, [light]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (isPublic) return;
    if (user.error instanceof ApiError && user.error.status === 401) {
      const invite =
        screen === "onboarding"
          ? new URLSearchParams(location.search).get("invite")
          : null;
      router.replace(
        invite ? "/login?invite=" + encodeURIComponent(invite) : "/login",
      );
    } else if (list.data?.length === 0 && screen !== "onboarding")
      router.replace("/onboarding");
  }, [isPublic, list.data, router, screen, user.error]);
  const orgId = org?.id;
  useEffect(() => {
    if (demo || !orgId || isPublic || screen === "onboarding") return;
    const { socket, close } = openWorkspaceSocket(() => liveRequest("orgs/" + orgId + "/membership"));
    socket.on("connect", () => {
      socket.emit("workspace.join", orgId, () => {});
    });
    socket.on("task.changed", () => {
      void client.invalidateQueries({
        queryKey: ["orgs/" + orgId, "snapshot"],
      });
    });
    socket.on("notification.created", () => {
      void client.invalidateQueries({
        queryKey: ["collab/" + orgId + "/notifications"],
      });
    });
    return close;
  }, [client, demo, isPublic, orgId, screen]);

  function notify(message: string, error = false) {
    setToast({ message, error });
  }
  function switchOrg(id: string, returnToProjects = true) {
    setSelected(id);
    setExpanded("");
    setMobile(false);
    setEditor(null);
    localStorage.setItem("nexusflow-org-" + demo, id);
    if (returnToProjects && (projectId || screen === "onboarding")) router.push("/projects");
  }
  async function createOrg(name: string) {
    if (!name) throw new Error("Enter a workspace name.");
    const created = await request<Org>("orgs", "POST", { name });
    await list.refetch();
    switchOrg(created.id);
    router.push("/projects");
  }
  async function acceptInvite(token: string) {
    const joined = await request<{ id: string }>(
      "orgs/accept-invitation",
      "POST",
      { token },
    );
    await list.refetch();
    switchOrg(joined.id);
    router.push("/projects");
  }
  async function refresh() {
    await Promise.all([
      snapshot.refetch(),
      client.invalidateQueries({
        queryKey: ["collab/" + org?.id + "/notifications"],
      }),
    ]);
  }
  async function refreshSettings() {
    await Promise.all([refresh(), list.refetch(), user.refetch()]);
  }
  async function save(values: FormValues) {
    if (!editor) return;
    const task = editor.kind === "task" ? editor.value : undefined;
    const {
      title,
      description,
      status,
      priority,
      team,
      startDate,
      dueDate,
      owner,
      projectId,
      assignee,
      archived,
    } = values;
    const payload =
      editor.kind === "project"
        ? {
            title: title.trim(),
            description,
            status,
            priority,
            team,
            startDate: startDate || null,
            dueDate: dueDate || null,
            owner: owner || null,
            archived,
          }
        : {
            title: title.trim(),
            description,
            status,
            priority,
            projectId,
            assignee: assignee || null,
            dueDate: dueDate || null,
            version: task?.version,
          };
    const path =
      base +
      "/" +
      (editor.kind === "project" ? "projects" : "tasks") +
      (editor.value ? "/" + editor.value.id : "");
    await request(path, editor.value ? "PATCH" : "POST", payload);
    setEditor(null);
    await refresh();
    notify(
      editor.value
        ? "Changes saved"
        : editor.kind === "project"
          ? "Project created"
          : "Task created",
    );
  }
  async function bulk(tasks: Task[], status: string) {
    try {
      await request(base + "/tasks/bulk", "POST", {
        status,
        tasks: tasks.map(({ id, version }) => ({ id, version })),
      });
      await refresh();
      notify("Tasks updated");
      return true;
    } catch (error) {
      notify(errorText(error), true);
      await refresh();
      return false;
    }
  }
  const move = useMutation({
    mutationFn: ({ task, status }: { task: Task; status: string }) =>
      request(base + "/tasks/" + task.id, "PATCH", { ...task, status }),
    onMutate: async ({ task, status }) => {
      const key = [base, "snapshot"];
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Snapshot>(key);
      client.setQueryData<Snapshot>(key, (old) =>
        old
          ? {
              ...old,
              tasks: old.tasks.map((item) =>
                item.id === task.id ? { ...item, status } : item,
              ),
            }
          : old,
      );
      return { previous, key };
    },
    onError: (error, _, context) => {
      if (context?.previous) client.setQueryData(context.key, context.previous);
      notify(errorText(error), true);
    },
    onSettled: () => refresh(),
  });
  const toastView = toast && (
    <div
      role={toast.error ? "alert" : "status"}
      className={"toast " + (toast.error ? "error" : "")}
    >
      {toast.message}
      <Button
        className="icon ghost"
        aria-label="Dismiss notification"
        onClick={() => setToast(null)}
      >
        <X size={16} />
      </Button>
    </div>
  );
  if (isPublic) return <PublicPage screen={screen} request={request} />;
  if (screen === "onboarding" && user.data)
    return (
      <>
        <Onboarding notify={notify} create={createOrg} accept={acceptInvite} />
        {toastView}
      </>
    );
  if (!org || !user.data || !snapshot.data)
    return (
      <div className="loading-shell">
        <Brand />
        {user.isError || list.isError || snapshot.isError ? (
          <>
            <p role="alert">
              {errorText(user.error ?? list.error ?? snapshot.error)}
            </p>
            <Button onClick={() => location.reload()}>Retry</Button>
          </>
        ) : (
          <p role="status">Loading workspace…</p>
        )}
      </div>
    );

  const data = snapshot.data;
  const project = projectId
    ? data.projects.find((project) => project.id === projectId)
    : undefined;
  const manage = ["Owner", "Admin", "Project Manager"].includes(org.role);
  const contribute = org.role !== "Viewer";
  const admin = org.role === "Owner" || org.role === "Admin";
  const title =
    labels[screen] ??
    (screen === "notifications"
      ? "Notifications"
      : screen === "search"
        ? "Search"
        : "Workspace");
  function toggleTheme() {
    setLight(!light);
    localStorage.setItem("nexusflow-theme", light ? "dark" : "light");
  }
  async function logout() {
    try {
      await request("auth/logout", "POST");
      client.clear();
      router.replace("/login");
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  function open(next: Editor) {
    setEditor(next);
  }
  return (
    <div
      className={
        "app-shell" +
        (collapsed ? " collapsed" : "") +
        (mobile ? " mobile-open" : "")
      }
    >
      {mobile && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Link
            href="/projects"
            aria-label="NexusFlow projects"
            onClick={() => setMobile(false)}
          >
            <Brand small={collapsed} />
          </Link>
          <Button
            className="icon ghost sidebar-toggle"
            onClick={flip}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </Button>
        </div>
        <div className="sidebar-content">
          <div className="switch-wrap">
            <button
              className="workspace-switch"
              aria-expanded={expanded === "workspaces"}
              onClick={() =>
                setExpanded(expanded === "workspaces" ? "" : "workspaces")
              }
            >
              <span className="org-mark">
                {org.name
                  .split(" ")
                  .map((word) => word[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <span className="switch-text">
                <strong>{org.name}</strong>
                <small>{org.plan} workspace</small>
              </span>
              <ChevronsUpDown className="switch-caret" size={15} />
            </button>
            {expanded === "workspaces" && (
              <div className="popover workspace-popover">
                <span className="eyebrow">YOUR WORKSPACES</span>
                {list.data?.map((item) => (
                  <Button
                    key={item.id}
                    className={item.id === org.id ? "selected" : "ghost"}
                    onClick={() => switchOrg(item.id)}
                  >
                    {item.name}
                  </Button>
                ))}
                <Link
                  href="/onboarding"
                  className="button ghost"
                  onClick={() => setExpanded("")}
                >
                  <Plus size={16} /> New workspace
                </Link>
              </div>
            )}
          </div>
          <button
            className="side-search"
            onClick={() => setPalette(true)}
            aria-label="Global search"
          >
            <Search size={16} />
            <span>Quick search</span>
            <kbd>
              <Command size={11} /> K
            </kbd>
          </button>
          <nav aria-label="Main navigation">
            {menu.map((group) => (
              <div className="nav-group" key={group.name}>
                <div className="nav-label">{group.name}</div>
                {group.links
                  .filter((link) =>
                    link.id === "admin"
                      ? user.data?.platformAdmin
                      : link.id === "audit" || link.id === "billing"
                        ? admin
                        : true,
                  )
                  .map((link) => (
                    <Link
                      href={"/" + link.id}
                      key={link.id}
                      className={
                        "nav-link " + (screen === link.id ? "active" : "")
                      }
                      aria-current={screen === link.id ? "page" : undefined}
                      title={collapsed ? link.title : undefined}
                      onClick={() => {
                        setExpanded("");
                        setMobile(false);
                      }}
                    >
                      <link.icon size={18} />
                      <span>{link.title}</span>
                    </Link>
                  ))}
              </div>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <Link
            className="help-link"
            href="/settings"
            onClick={() => setMobile(false)}
          >
            <CircleHelp size={17} />
            <span>Workspace settings</span>
          </Link>
          <div className="account-wrap">
            <button
              className="account"
              aria-expanded={expanded === "account"}
              onClick={() =>
                setExpanded(expanded === "account" ? "" : "account")
              }
            >
              <Avatar name={user.data.name} />
              <span>
                <strong>{user.data.name}</strong>
                <small>{org.role}</small>
              </span>
              <ChevronDown size={15} />
            </button>
            {expanded === "account" && (
              <div className="popover account-popover">
                <Link
                  className="button ghost"
                  href="/settings"
                  onClick={() => setExpanded("")}
                >
                  <Settings size={16} /> Account settings
                </Link>
                <Button className="ghost" onClick={toggleTheme}>
                  {light ? <Moon size={16} /> : <Sun size={16} />}{" "}
                  {light ? "Dark theme" : "Light theme"}
                </Button>
                {!demo && (
                  <Button className="ghost" onClick={() => void logout()}>
                    <LogOut size={16} /> Sign out
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Button
              className="mobile-toggle icon ghost"
              onClick={() => setMobile(!mobile)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </Button>
            <span>{org.name}</span>
            <ChevronRight size={14} />
            <Link href={"/" + screen}>{title}</Link>
            {project && (
              <>
                <ChevronRight size={14} />
                <strong>{project.title}</strong>
              </>
            )}
          </div>
          <div className="top-actions">
            {staticDemo && (
              <Button className="ghost" onClick={() => setDemoGuide(true)}>Demo guide</Button>
            )}
            {demo && (
              <span className="demo-label">
                <span /> {staticDemo ? "Demo · saved in this browser" : "Demo workspace"}
              </span>
            )}
            <Button
              className="icon ghost theme-button"
              aria-label={
                light ? "Switch to dark theme" : "Switch to light theme"
              }
              onClick={toggleTheme}
            >
              {light ? <Moon size={18} /> : <Sun size={18} />}
            </Button>
            <Link
              className="button icon ghost notify-button"
              href="/notifications"
              aria-label={
                "Notifications" + (unseen ? " · " + unseen + " unread" : "")
              }
            >
              <Bell size={19} />
              {unseen > 0 && <span />}
            </Link>
            <Link href="/settings" aria-label="Profile settings">
              <Avatar name={user.data.name} small />
            </Link>
          </div>
        </header>
        <main className={"content content-" + screen}>
          {screen === "projects" && !projectId && (
            <Projects
              snapshot={data}
              manage={manage}
              open={open}
              label={org.name}
            />
          )}
          {screen === "projects" &&
            projectId &&
            (project ? (
              <TaskBoard
                key={project.id}
                bulk={bulk}
                tasks={data.tasks.filter(
                  (task) => task.projectId === project.id,
                )}
                project={project}
                manage={contribute}
                projectManage={manage}
                open={(next) => {
                  if (next.kind !== "project" || manage) open(next);
                }}
                move={(task, status) => move.mutate({ task, status })}
                people={data.team}
                pending={move.isPending}
              />
            ) : (
              <Empty>
                Project could not be found.{" "}
                <Link href="/projects">Back to projects</Link>
              </Empty>
            ))}
          {screen === "projects" && project && (
            <Milestones
              key={'milestones-' + project.id}
              path={base + "/projects/" + project.id + "/milestones"}
              request={request}
              manage={manage}
            />
          )}
          {screen === "tasks" && (
            <TaskBoard
              bulk={bulk}
              tasks={data.tasks.filter(
                (task) => task.assignee === user.data.id,
              )}
              manage={contribute}
              open={open}
              move={(task, status) => move.mutate({ task, status })}
              pending={move.isPending}
              people={data.team}
            />
          )}
          {screen === "calendar" && (
            <CalendarView tasks={data.tasks} open={open} />
          )}
          {screen === "messages" && (
            <Messages
              key={org.id}
              orgId={org.id}
              request={request}
              notify={notify}
              demo={demo}
              contribute={contribute}
              user={user.data}
              people={data.team}
              projects={data.projects}
            />
          )}
          {screen === "workflows" && (
            <Workflows
              key={org.id}
              rules={data.rules}
              orgId={org.id}
              request={request}
              notify={notify}
              refresh={refresh}
              manage={manage}
            />
          )}
          {(screen === "overview" || screen === "analytics") && (
            <Reports snapshot={data} analytics={screen === "analytics"} />
          )}
          {screen === "notifications" && (
            <Notifications orgId={org.id} request={request} notify={notify} />
          )}
          {screen === "team" && (
            <Team
              key={org.id}
              org={org}
              snapshot={data}
              user={user.data}
              request={request}
              notify={notify}
              refresh={refresh}
              demo={demo}
            />
          )}
          {screen === "settings" && (
            <SettingsView
              key={org.id}
              org={org}
              user={user.data}
              request={request}
              notify={notify}
              refresh={refreshSettings}
              demo={demo}
            />
          )}
          {screen === "billing" &&
            (admin ? (
              <Billing
                org={org}
                snapshot={data}
                request={request}
                notify={notify}
                refresh={refreshSettings}
              />
            ) : (
              <Empty>Workspace administrator access is required.</Empty>
            ))}
          {screen === "audit" &&
            (admin ? (
              <AuditView snapshot={data} />
            ) : (
              <Empty>Workspace administrator access is required.</Empty>
            ))}
          {screen === "admin" && (
            <AdminView request={request} notify={notify} />
          )}
          {screen === "search" && (
            <>
              <section className="page-intro">
                <div>
                  <h1>Search</h1>
                  <p>Find work across {org.name}.</p>
                </div>
              </section>
              <div className="panel section-panel">
                <SearchResults
                  org={org}
                  snapshot={data}
                  request={request}
                  orgs={list.data ?? []}
                  switchOrg={switchOrg}
                  open={open}
                />
              </div>
            </>
          )}
        </main>
      </div>
      {palette && (
        <Modal title="Search workspace" close={() => setPalette(false)}>
          <SearchResults
            org={org}
            snapshot={data}
            request={request}
            orgs={list.data ?? []}
            switchOrg={(id) => {
              setPalette(false);
              switchOrg(id);
            }}
            open={(next) => {
              setPalette(false);
              open(next);
            }}
            close={() => setPalette(false)}
          />
        </Modal>
      )}
      {staticDemo && demoGuide && (
        <Modal title="Try NexusFlow" close={() => setDemoGuide(false)}>
          <p>Open <strong>Workspace onboarding</strong>, create a task, then move it to <strong>Completed</strong>. Check <strong>Notifications</strong> for the result.</p>
          <p>This preview uses sample data and saves changes in this browser. The walkthrough shows the same flow on the full stack with Kafka and PostgreSQL.</p>
          <div className="inline">
            <Link className="button" href={projectHref("00000000-0000-4000-8000-000000000205")} onClick={() => {
              switchOrg("00000000-0000-4000-8000-000000000001", false);
              setDemoGuide(false);
            }}>Open sample project</Link>
            <a className="button ghost" href="/walkthrough.webm" target="_blank" rel="noreferrer">Watch walkthrough</a>
          </div>
        </Modal>
      )}
      {editor && (
        <RecordEditor
          key={editor.kind + (editor.value?.id ?? "new")}
          editor={editor}
          snapshot={data}
          save={save}
          close={() => setEditor(null)}
          request={request}
          orgId={org.id}
          demo={demo}
          manage={editor.kind === "project" ? manage : contribute}
        />
      )}
      {toastView}
    </div>
  );
}

function SearchResults({
  org,
  snapshot,
  request,
  orgs,
  switchOrg,
  open,
  close,
}: {
  org: Org;
  snapshot: Snapshot;
  request: Request;
  orgs: Org[];
  switchOrg: (id: string) => void;
  open: (editor: Editor) => void;
  close?: () => void;
}) {
  const [input, setInput] = useState("");
  const [remote, setRemote] = useState("");
  const query = input.trim().toLowerCase();
  useEffect(() => {
    const timer = setTimeout(() => setRemote(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const path = "collab/" + org.id + "/search?q=" + encodeURIComponent(remote);
  const messages = useQuery({
    queryKey: [path],
    queryFn: () => request<MessageMatch[]>(path),
    enabled: remote.length >= 2,
  });
  const results = useMemo(() => {
    const pages = menu
      .flatMap((group) => group.links)
      .filter(
        (link) =>
          link.id !== "admin" &&
          (!["billing", "audit"].includes(link.id) ||
            ["Owner", "Admin"].includes(org.role)),
      );
    return [
      ...pages
        .filter((link) => link.title.toLowerCase().includes(query))
        .slice(0, 8)
        .map((link) => ({
          id: link.id,
          title: link.title,
          kind: "Page",
          href: "/" + link.id,
        })),
      ...snapshot.projects
        .filter(
          (project) =>
            !project.archived &&
            (project.title + " " + project.description)
              .toLowerCase()
              .includes(query),
        )
        .slice(0, 7)
        .map((project) => ({
          id: project.id,
          title: project.title,
          kind: "Project",
          href: projectHref(project.id),
        })),
      ...snapshot.tasks
        .filter((task) => query && task.title.toLowerCase().includes(query))
        .slice(0, 7)
        .map((task) => ({
          id: task.id,
          title: task.title,
          kind: "Task",
          action: () => open({ kind: "task", value: task }),
        })),
      ...snapshot.team
        .filter(
          (person) =>
            query &&
            (person.name + " " + person.email).toLowerCase().includes(query),
        )
        .slice(0, 5)
        .map((person) => ({
          id: person.id,
          title: person.name,
          kind: "Member",
          href: "/team",
        })),
      ...orgs
        .filter(
          (workspace) => query && workspace.name.toLowerCase().includes(query),
        )
        .map((workspace) => ({
          id: workspace.id,
          title: workspace.name,
          kind: "Workspace",
          action: () => switchOrg(workspace.id),
        })),
      ...(remote === query ? (messages.data ?? []) : []).map((message) => ({
        id: message.id,
        title: message.body,
        kind: "#" + message.channel,
        href: "/messages?channel=" + message.channelId,
      })),
    ];
  }, [messages.data, open, org.role, orgs, query, remote, snapshot, switchOrg]);
  return (
    <div className="search-results">
      <label className="input-search">
        <Search size={17} />
        <input
          autoFocus
          aria-label="Search workspace"
          placeholder="Search projects, tasks, people, messages…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </label>
      <div className="record-list">
        {results.map((item) =>
          "href" in item && item.href ? (
            <Link
              key={item.kind + item.id}
              href={item.href}
              className="record"
              onClick={close}
            >
              <div>{item.title}</div>
              <span>{item.kind}</span>
            </Link>
          ) : (
            <button
              key={item.kind + item.id}
              className="record text-button"
              onClick={"action" in item ? item.action : undefined}
            >
              <div>{item.title}</div>
              <span>{item.kind}</span>
            </button>
          ),
        )}
        {!results.length && <Empty>No matches found.</Empty>}
      </div>
    </div>
  );
}
