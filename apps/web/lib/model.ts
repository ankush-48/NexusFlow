export const screens = [
  "home",
  "pricing",
  "login",
  "register",
  "forgot-password",
  "onboarding",
  "overview",
  "projects",
  "tasks",
  "calendar",
  "messages",
  "workflows",
  "analytics",
  "team",
  "notifications",
  "search",
  "settings",
  "billing",
  "audit",
  "admin",
] as const;
export type Screen = (typeof screens)[number];
export const staticDemo = process.env.NEXT_PUBLIC_NEXUS_STATIC === "1";
export function projectHref(projectId: string) {
  return staticDemo
    ? "/projects/?project=" + encodeURIComponent(projectId)
    : "/projects/" + encodeURIComponent(projectId);
}
export const statuses = ["Planned", "In progress", "Completed"] as const;
export const priorities = ["Low", "Medium", "High", "Urgent"] as const;
export const plans = ["Free", "Professional", "Enterprise"] as const;
export const triggers = [
  "task.created",
  "task.completed",
  "task.overdue",
  "task.due_soon",
  "project.completed",
  "member.joined",
] as const;

export type Person = { id: string; name: string; email: string; role: string };
export type Org = { id: string; name: string; plan: string; role: string };
export type Project = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  team: string;
  dueDate: string | null;
  startDate: string | null;
  owner: string | null;
  progress: number;
  archived: boolean;
};
export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignee: string | null;
  version: number;
  updatedAt: string;
  createdAt?: string;
  completedAt: string | null;
};
export type Message = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  authorId?: string;
  editedAt?: string | null;
  readCount?: number;
  reactions?: { emoji: string; count: number; mine: boolean }[];
};
export type Channel = {
  id: string;
  name: string;
  kind?: "channel" | "project" | "direct" | "group";
  unread?: number;
};
export type Notice = {
  id: string;
  title: string;
  read: boolean;
  href?: string | null;
  createdAt: string;
};
export type Rule = {
  id: string;
  title: string;
  trigger: string;
  priority: string;
  message: string;
  active: boolean;
};
export type Execution = {
  id: string;
  ruleId: string;
  title: string;
  createdAt: string;
  status: string;
};
export type Audit = {
  id: string;
  action: string;
  target: string;
  createdAt: string;
};
export type Invoice = {
  id: string;
  plan: string;
  amount: number;
  createdAt: string;
};
export type Snapshot = {
  projects: Project[];
  tasks: Task[];
  team: Person[];
  rules: Rule[];
  audit: Audit[];
  invoices: Invoice[];
  teams?: string[];
};
export type Invitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
};
export type Comment = {
  id: string;
  name: string;
  body: string;
  createdAt: string;
};
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function formatDate(
  value: string | null,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(value));
}
export const today = () => new Date().toISOString().slice(0, 10);
export const dateOffset = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export function tally(tasks: Task[]) {
  const completed = tasks.filter((task) => task.status === "Completed").length;
  return {
    completed,
    open: tasks.length - completed,
    overdue: tasks.filter(
      (task) =>
        task.status !== "Completed" && task.dueDate && task.dueDate < today(),
    ).length,
  };
}
