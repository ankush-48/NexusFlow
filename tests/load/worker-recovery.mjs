import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

// The native release check supplies its own process supervisor. The CLI uses Compose.
export async function verifyWorkerRecovery(stopWorker, startWorker) {
  const target = new URL(process.env.NEXUS_TEST_URL || "http://127.0.0.1:3000");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
  assert.equal(process.env.NEXUS_DISPOSABLE, "1", "Use a disposable stack for the interruption drill.");
  let cookie = "";
  const label = "Recovery " + randomUUID();
  async function request(path, method, body, status = 200) {
    const response = await fetch(target.origin + "/api/" + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { cookie, origin: target.origin, "content-type": "application/json" },
      signal: AbortSignal.timeout(6000), redirect: "error",
    });
    if (response.status !== status) throw Error("Expected " + status + " for " + path + ", got " + response.status);
    if (response.headers.has("set-cookie")) cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    return response.json();
  }
  const register = await request("auth/register", "POST", {
    email: "recovery-" + randomUUID() + "@example.test", name: "Recovery test", password: randomUUID(),
  }, 201);
  assert.equal(register.verificationRequired, false);
  const { id: actor } = await request("auth/me", "GET");
  const { id: org } = await request("orgs", "POST", { name: label }, 201);
  const root = "orgs/" + org;
  const noticesPath = "collab/" + org + "/notifications";
  const { id: projectId } = await request(root + "/projects", "POST", {
    title: label, description: "", priority: "High", status: "Planned", team: "Delivery", owner: actor, archived: false,
  }, 201);
  const { id: ruleId } = await request(root + "/rules", "POST", {
    title: label, message: label, trigger: "task.created", active: true, priority: "Any",
  }, 201);
  assert.deepEqual(await request(noticesPath, "GET"), []);
  const startedAt = new Date().toISOString();
  let restartAt;
  const created = [];
  try {
    await stopWorker();
    const deadline = performance.now() + 20000;
    for (;;) {
      const probe = await fetch(target.origin + "/api/" + noticesPath, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
      await probe.arrayBuffer();
      if ([500, 502, 503, 504].includes(probe.status)) break;
      if (performance.now() >= deadline) throw Error("The worker remained reachable throughout the stop window.");
      await sleep(200);
    }
    for (let i = 0; i < 3; i++) {
      const { id } = await request(root + "/tasks", "POST", {
        projectId, title: "Queued task " + i, description: "", priority: "High", status: "Planned", assignee: actor,
      }, 201);
      created.push(id);
    }
    await sleep(3500);
    const snapshot = await request(root + "/snapshot", "GET");
    assert.deepEqual(snapshot.tasks.map(task => task.id).sort(), created.sort());
    assert.equal((await request(root + "/executions", "GET")).length, 0);
  } finally {
    restartAt = performance.now();
    await startWorker();
  }
  const deadline = restartAt + 90000;
  let deliveredMs;
  while (performance.now() < deadline) {
    const runs = await request(root + "/executions", "GET");
    if (runs.length === created.length && runs.every(run => run.ruleId === ruleId && run.status === "Succeeded")) {
      const notices = await request(noticesPath, "GET");
      assert.equal(notices.filter(n => n.title === label).length, created.length);
      deliveredMs = Math.round(performance.now() - restartAt);
      break;
    }
    await sleep(500);
  }
  assert.ok(deliveredMs !== undefined, "Recovery exceeded the 90-second test deadline.");
  await sleep(3500);
  const verifiedRuns = await request(root + "/executions", "GET");
  const verifiedNotices = await request(noticesPath, "GET");
  assert.equal(new Set(verifiedRuns.map(run => run.id)).size, created.length);
  assert.equal(verifiedRuns.length, created.length);
  assert.equal(verifiedNotices.length, created.length);
  assert.equal(new Set(verifiedNotices.map(notice => notice.id)).size, created.length);
  const report = { startedAt, acceptedDuringInterruption: created.length, succeededRuns: verifiedRuns.length,
    durableNotices: verifiedNotices.length, restartRequestToVerifiedDeliveryMs: deliveredMs, passed: true };
  if (process.env.NEXUS_RECOVERY_REPORT) await writeFile(process.env.NEXUS_RECOVERY_REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  assert.equal(process.argv[2], "--compose", "Pass --compose to interrupt the disposable local realtime service.");
  // Scope lifecycle commands to the repository's local compose project. Refuse remote Docker contexts.
  const docker = promisify(execFile);
  const options = { windowsHide: true, timeout: 90000 };
  const context = (await docker("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], options)).stdout.trim();
  for (const endpoint of [context, process.env.DOCKER_HOST].filter(Boolean)) {
    assert.match(endpoint, /^(unix:\/\/|npipe:\/\/)/, "Use the local Docker engine for the interruption drill.");
  }
  await verifyWorkerRecovery(
    () => docker("docker", ["compose", "stop", "realtime"], options),
    () => docker("docker", ["compose", "up", "-d", "--no-build", "--no-deps", "--wait", "realtime"], options),
  );
}
