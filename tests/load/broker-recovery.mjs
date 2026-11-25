import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

export async function verifyBrokerRecovery(stopBroker, startBroker) {
  const origin = new URL(process.env.NEXUS_TEST_URL || "http://127.0.0.1:3000");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  assert.equal(process.env.NEXUS_DISPOSABLE, "1", "Use an isolated test installation.");
  const stamp = "Broker recovery " + randomUUID();
  let cookie = "";
  async function request(path, method = "GET", body, expected = 200) {
    const response = await fetch(new URL("/api/" + path, origin), {
      method,
      headers: { cookie, origin: origin.origin, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(response.status, expected, path);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map(value => value.split(";")[0]).join("; ");
    return response.json();
  }
  const registration = await request("auth/register", "POST", {
    name: "Broker test", email: randomUUID() + "@example.test", password: randomUUID(),
  }, 201);
  assert.equal(registration.verificationRequired, false);
  const { id: userId } = await request("auth/me");
  const { id: orgId } = await request("orgs", "POST", { name: stamp }, 201);
  const org = "orgs/" + orgId;
  const { id: projectId } = await request(org + "/projects", "POST", {
    title: stamp, description: "", status: "Planned", priority: "High", team: "Delivery", archived: false,
  }, 201);
  const { id: ruleId } = await request(org + "/rules", "POST", {
    title: stamp, message: stamp, priority: "Any", trigger: "task.created", active: true,
  }, 201);
  const created = [];
  let restartAt;
  try {
    await stopBroker();
    for (let index = 0; index < 3; index++) {
      const task = await request(org + "/tasks", "POST", {
        projectId, title: "During broker interruption " + index, description: "",
        status: "Planned", priority: "High", assignee: userId,
      }, 201);
      created.push(task.id);
    }
    const { tasks } = await request(org + "/snapshot");
    assert.deepEqual(tasks.map(task => task.id).sort(), [...created].sort());
    assert.deepEqual(await request(org + "/executions"), []);
  } finally {
    restartAt = performance.now();
    await startBroker();
  }
  const noticesPath = "collab/" + orgId + "/notifications";
  const deadline = restartAt + 120000;
  let deliveredMs;
  while (performance.now() < deadline) {
    const runs = await request(org + "/executions");
    if (runs.length === created.length && runs.every(run => run.ruleId === ruleId && run.status === "Succeeded")) {
      deliveredMs = Math.round(performance.now() - restartAt);
      break;
    }
    await sleep(750);
  }
  assert.ok(deliveredMs !== undefined, "Broker recovery exceeded the test deadline.");
  await sleep(3500);
  const runs = await request(org + "/executions");
  const notices = await request(noticesPath);
  assert.equal(runs.length, created.length);
  assert.equal(new Set(runs.map(run => run.id)).size, created.length);
  assert.equal(notices.length, created.length);
  assert.ok(notices.every(notice => notice.title === stamp));
  assert.equal(new Set(notices.map(notice => notice.id)).size, created.length);
  const report = { acceptedDuringInterruption: created.length, succeededRuns: runs.length,
    durableNotices: notices.length, restartRequestToVerifiedDeliveryMs: deliveredMs, passed: true };
  if (process.env.NEXUS_RECOVERY_REPORT) await writeFile(process.env.NEXUS_RECOVERY_REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  assert.equal(process.argv[2], "--compose");
  assert.equal(process.env.NEXUS_DISPOSABLE, "1");
  const docker = promisify(execFile);
  const options = { timeout: 120000, windowsHide: true };
  const { stdout } = await docker("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], options);
  for (const endpoint of [stdout.trim(), process.env.DOCKER_HOST].filter(Boolean)) {
    assert.match(endpoint, /^(unix:\/\/|npipe:\/\/)/, "Use a local Docker context.");
  }
  await verifyBrokerRecovery(
    () => docker("docker", ["compose", "stop", "kafka"], options),
    () => docker("docker", ["compose", "up", "-d", "--no-build", "--no-deps", "--wait", "kafka"], options),
  );
}
