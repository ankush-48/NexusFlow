import { describe, expect, it } from "vitest";
import { dateOffset, formatDate, initials, tally, type Task } from "./model";

describe("workspace metrics", () => {
  it("counts open and overdue work without counting completed work or tasks due today as overdue", () => {
    const task = {
      id: "1",
      projectId: "p",
      title: "Work",
      description: "",
      priority: "High",
      assignee: null,
      version: 0,
      updatedAt: dateOffset(0),
      completedAt: null,
    };
    const tasks: Task[] = [
      { ...task, status: "Planned", dueDate: dateOffset(-1) },
      { ...task, status: "In progress", dueDate: dateOffset(0) },
      { ...task, status: "Planned", dueDate: null },
      { ...task, status: "Completed", dueDate: dateOffset(-2) },
    ];
    expect(tally(tasks)).toEqual({ open: 3, completed: 1, overdue: 1 });
  });
  it("formats date-only values in UTC", () =>
    expect(formatDate("2026-01-01")).toBe("Jan 1"));
  it("normalizes multi-part display names", () =>
    expect(initials("  Alex   Morgan  ")).toBe("AM"));
});
