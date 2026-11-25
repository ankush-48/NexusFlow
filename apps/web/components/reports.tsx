"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  Download,
  Folders,
  ListChecks,
  Timer,
  TriangleAlert,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  dateOffset,
  formatDate,
  projectHref,
  statuses,
  tally,
  today,
  type Snapshot,
} from "../lib/model";
import { Avatar, Empty, StatusIcon } from "./common";
import { Button } from "./ui/button";

function exportCsv(rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map(
          (cell) =>
            '"' +
            (/^[=+\-@\t\r]/.test(cell) ? "'" : "") +
            cell.replaceAll('"', '""') +
            '"',
        )
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "nexusflow-tasks.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Reports({
  snapshot,
  analytics,
}: {
  snapshot: Snapshot;
  analytics: boolean;
}) {
  const [days, setDays] = useState(30);
  const from = dateOffset(1 - days);
  const tasks = analytics
    ? snapshot.tasks.filter(
        (task) =>
          task.updatedAt.slice(0, 10) >= from ||
          (task.completedAt?.slice(0, 10) ?? "") >= from,
      )
    : snapshot.tasks;
  const count = tally(tasks);
  const points = Array.from({ length: days }, (_, index) => {
    const date = dateOffset(index + 1 - days);
    return {
      date: formatDate(date),
      completed: tasks.filter((task) => task.completedAt?.slice(0, 10) === date)
        .length,
    };
  });
  const distribution = statuses.map((status) => ({
    name: status,
    value: tasks.filter((task) => task.status === status).length,
  }));
  const deadlines = tasks
    .filter(
      (task) =>
        task.status !== "Completed" && task.dueDate && task.dueDate >= today(),
    )
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 5);
  const active = snapshot.projects.filter((project) => !project.archived);
  const resolved = tasks.filter((task) => task.createdAt && task.completedAt);
  const elapsed = resolved.reduce(
    (sum, task) =>
      sum +
      Math.max(0, Date.parse(task.completedAt!) - Date.parse(task.createdAt!)),
    0,
  );
  const average = resolved.length
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
        elapsed / resolved.length / 86_400_000,
      ) + " days"
    : "No completed tasks";
  const projects = new Map<
    string,
    { completed: number; overdue: number; total: number }
  >();
  for (const task of tasks) {
    const record = projects.get(task.projectId) ?? {
      completed: 0,
      overdue: 0,
      total: 0,
    };
    record.total++;
    if (task.status === "Completed") record.completed++;
    if (task.status !== "Completed" && task.dueDate && task.dueDate < today())
      record.overdue++;
    projects.set(task.projectId, record);
  }
  const colors = ["#77869b", "#a693ff", "#55dcb0"];
  return (
    <>
      <section className="page-intro">
        <div>
          <div className="eyebrow">
            <Activity size={14} /> DELIVERY INSIGHTS
          </div>
          <h1>{analytics ? "Analytics" : "Overview"}</h1>
          <p>
            {analytics
              ? "Explore task completion and workload across your workspace."
              : "See how projects are progressing and what needs attention."}
          </p>
        </div>
        {analytics && (
          <div className="inline">
            <select
              aria-label="Date range"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <Button
              onClick={() =>
                exportCsv([
                  ["Task", "Project", "Status", "Priority", "Due date"],
                  ...tasks.map((task) => [
                    task.title,
                    snapshot.projects.find(
                      (project) => project.id === task.projectId,
                    )?.title ?? "",
                    task.status,
                    task.priority,
                    task.dueDate ?? "",
                  ]),
                ])
              }
            >
              <Download size={16} /> CSV
            </Button>
          </div>
        )}
      </section>
      <div className="stats">
        {[
          {
            label: "Projects",
            value: active.length,
            icon: Folders,
            tone: "iris",
          },
          {
            label: "Completed tasks",
            value: count.completed,
            icon: ListChecks,
            tone: "sea",
          },
          { label: "Open tasks", value: count.open, icon: Timer, tone: "sky" },
          {
            label: "Overdue",
            value: count.overdue,
            icon: TriangleAlert,
            tone: "gold",
          },
        ].map((stat) => (
          <div key={stat.label} className="stat">
            <div className="stat-top">
              <span>{stat.label}</span>
              <span className={"stat-icon tone-" + stat.tone}>
                <stat.icon size={16} />
              </span>
            </div>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
      <div className="report-grid">
        <div className="panel report">
          <div className="report-head">
            <h2>
              <ChartNoAxesCombined size={17} /> Task completion
            </h2>
            <span className="muted">Last {days} days</span>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="date"
                  minTickGap={42}
                  stroke="var(--muted)"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  width={28}
                  stroke="var(--muted)"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="completed"
                  name="Completed tasks"
                  stroke="#a693ff"
                  strokeWidth={2}
                  fill="#a693ff"
                  fillOpacity={0.12}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="panel report">
          <div className="report-head">
            <h2>
              <ListChecks size={17} /> Task distribution
            </h2>
          </div>
          {tasks.length ? (
            <div className="chart donut">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                    }}
                  />
                  <Pie
                    data={distribution}
                    dataKey="value"
                    innerRadius={49}
                    outerRadius={70}
                    paddingAngle={3}
                    stroke="none"
                  >
                    {distribution.map((entry, index) => (
                      <Cell key={entry.name} fill={colors[index]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty>No tasks in this time range.</Empty>
          )}
          <div className="chart-legend">
            {distribution.map((item) => (
              <div key={item.name}>
                <StatusIcon status={item.name} />
                <span>{item.name}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="panel report">
          <div className="report-head">
            <h2>
              <CalendarDays size={17} /> Upcoming deadlines
            </h2>
            <Link href="/calendar" className="inline">
              Calendar <ChevronRight size={15} />
            </Link>
          </div>
          <div className="record-list">
            {deadlines.map((task) => (
              <Link
                key={task.id}
                className="record"
                href={projectHref(task.projectId)}
              >
                <StatusIcon status={task.status} />
                <div>
                  <strong>{task.title}</strong>
                  <small>
                    {snapshot.projects.find(
                      (project) => project.id === task.projectId,
                    )?.title ?? "Project"}
                  </small>
                </div>
                <span>{formatDate(task.dueDate)}</span>
              </Link>
            ))}
            {!deadlines.length && <Empty>No upcoming deadlines.</Empty>}
          </div>
        </div>
        <div className="panel report">
          <div className="report-head">
            <h2>
              <Users size={17} /> Team workload
            </h2>
          </div>
          <div className="record-list">
            {snapshot.team.map((person) => (
              <div className="record" key={person.id}>
                <Avatar name={person.name} small />
                <div>
                  <strong>{person.name}</strong>
                </div>
                <span>
                  {
                    tasks.filter(
                      (task) =>
                        task.assignee === person.id &&
                        task.status !== "Completed",
                    ).length
                  }{" "}
                  open ·{" "}
                  {
                    tasks.filter(
                      (task) =>
                        task.assignee === person.id &&
                        task.status === "Completed",
                    ).length
                  }{" "}
                  done
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {analytics && (
        <section className="panel section-panel">
          <div className="report-head">
            <h2>Project performance</h2>
            <span className="muted">Average task resolution · {average}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Completed</th>
                  <th>Overdue</th>
                  <th>Completion rate</th>
                </tr>
              </thead>
              <tbody>
                {active.map((project) => {
                  const data = projects.get(project.id);
                  if (!data) return null;
                  return (
                    <tr key={project.id}>
                      <td>
                        <Link href={projectHref(project.id)}>
                          {project.title}
                        </Link>
                      </td>
                      <td>
                        {data.completed} / {data.total}
                      </td>
                      <td>{data.overdue}</td>
                      <td>
                        {Math.round((100 * data.completed) / data.total)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
