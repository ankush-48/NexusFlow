import { expect, test } from "@playwright/test";

test("register, onboard, and create a project against the Java API", async ({
  page,
}) => {
  const unique = Date.now();
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Integration Tester");
  await page
    .getByLabel("Email", { exact: true })
    .fill("tester-" + unique + "@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Integration-Test-Password-927!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Set up a workspace" }),
  ).toBeVisible();
  await page
    .getByLabel("Workspace name", { exact: true })
    .fill("Browser QA " + unique);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Backend-connected project");
  await page
    .getByLabel("Description")
    .fill("Created through the Next.js frontend.");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Backend-connected project" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Backend-connected project" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Message persisted through NestJS");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("Message persisted through NestJS"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Message persisted through NestJS"),
  ).toBeVisible();
});
