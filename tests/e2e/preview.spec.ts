import { expect, test } from "@playwright/test";

test("project views, filters, and persistence", async ({ page }) => {
  const faults: string[] = [];
  page.on("pageerror", (error) => faults.push(error.message));
  await page.goto("/projects");
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Customer insights hub" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "Due date" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Billing infrastructure" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByLabel("Search projects").fill("billing");
  await expect(
    page.getByRole("link", { name: "Customer insights hub" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Billing infrastructure" }),
  ).toBeVisible();
  await page.getByLabel("Search projects").clear();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Release checklist");
  await page.getByLabel("Description").fill("Validate project persistence.");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("link", { name: "Release checklist" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Release checklist" }),
  ).toBeVisible();
  expect(faults).toEqual([]);
});

test("task move, workflow notification, and messaging", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("link", { name: "Workspace onboarding" }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Verify automation");
  await page
    .getByLabel("Description")
    .fill("Complete this task to trigger a notification.");
  await page.getByRole("button", { name: "Create task" }).click();
  const task = page
    .locator("article.task-card")
    .filter({ hasText: "Verify automation" });
  await expect(task).toBeVisible();
  const destination = page
    .getByRole("region", { name: "Completed", exact: true })
    .locator(".lane-header");
  await task.dragTo(destination, {
    sourcePosition: { x: 15, y: 45 },
    targetPosition: { x: 25, y: 27 },
  });
  await expect(
    page
      .getByRole("region", { name: "Completed", exact: true })
      .getByText("Verify automation"),
  ).toBeVisible();
  await page.getByRole("link", { name: /Notifications/ }).click();
  await expect(page.getByText("A task has been completed.")).toBeVisible();
  await page.getByRole("link", { name: "Workflows", exact: true }).click();
  await page.getByRole("button", { name: "Executions", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Succeeded" })).toBeVisible();
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("End-to-end collaboration check");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("End-to-end collaboration check")).toBeVisible();
  await page.reload();
  await expect(page.getByText("End-to-end collaboration check")).toBeVisible();
});

test("mobile navigation and command palette", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/projects");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Global search" }).click();
  await page
    .getByRole("textbox", { name: "Search workspace", exact: true })
    .fill("design system");
  await expect(
    page.getByRole("dialog").getByRole("link", { name: /Design system v2/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
