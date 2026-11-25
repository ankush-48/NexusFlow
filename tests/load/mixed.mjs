import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { io } from "socket.io-client";

const target = new URL(process.env.NEXUS_TEST_URL || "http://127.0.0.1:3000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    !["http:", "https:"].includes(target.protocol) || process.env.NEXUS_DISPOSABLE !== "1") {
  throw Error("Run against a disposable loopback stack with NEXUS_DISPOSABLE=1.");
}
const origin = target.origin;
const plateauSeconds = Number(process.env.NEXUS_PLATEAU_SECONDS || 300);
assert.ok(Number.isInteger(plateauSeconds) && plateauSeconds >= 1 && plateauSeconds <= 720);
const rampSeconds = 30;
// Keep the fixture within the single-client rate limit and the 100-record history windows.
const periodMs = Math.max(1900, Math.ceil((plateauSeconds + 30) * 1000 / 180));
const durationMs = (2 * rampSeconds + plateauSeconds) * 1000;
const stamp = randomUUID().slice(0, 8);
const actors = [];
const tenants = [];
const samples = [];
let timedStart;
const phaseAt = (ms) => ms < rampSeconds * 1000 ? "rampUp"
  : ms < (rampSeconds + plateauSeconds) * 1000 ? "plateau" : "rampDown";

async function call(actor, path, { method = "GET", body, status = 200 } = {}) {
  const response = await fetch(origin + "/api/" + path, {
    method,
    headers: {
      cookie: actor.cookie,
      origin,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (response.status !== status) throw Error("HTTP " + response.status);
  const issued = response.headers.getSetCookie();
  if (issued.length) actor.cookie = issued.map(value => value.split(";")[0]).join("; ");
  return status === 204 ? null : response.json();
}

async function openChannel(actor) {
  actor.socket = io(origin, {
    transports: ["websocket"], reconnection: false, autoConnect: false, timeout: 6000,
    extraHeaders: { Cookie: actor.cookie, Origin: origin },
  });
  actor.socket.on("message.created", () => actor.deliveries++);
  await new Promise((resolve, reject) => {
    actor.socket.once("connect", resolve).once("connect_error", reject).connect();
  });
  const join = await actor.socket.timeout(5000).emitWithAck("channel.join", {
    orgId: actor.tenant.id, channelId: actor.tenant.channel,
  });
  assert.equal(join.ok, true);
}

async function setup() {
  for (let i = 0; i < 12; i++) {
    const actor = { cookie: "", index: i, version: 0, completions: 0, deliveries: 0 };
    actors.push(actor);
    const email = "load-" + stamp + "-" + i + "@example.test";
    const registration = await call(actor, "auth/register", {
      method: "POST", status: 201,
      body: { name: "Load user " + i, email, password: randomUUID() },
    });
    assert.equal(registration.verificationRequired, false, "Disable verification only in the disposable test stack.");
    actor.id = (await call(actor, "auth/me")).id;
    // Round-robin assignment keeps all three workspaces active throughout the ramps.
    if (i < 3) {
      const { id } = await call(actor, "orgs", {
        method: "POST", status: 201, body: { name: "Load " + stamp + "-" + i },
      });
      const root = "orgs/" + id;
      const { id: project } = await call(actor, root + "/projects", {
        method: "POST", status: 201,
        body: { title: "Release board", description: "", team: "Delivery", priority: "High",
          owner: actor.id, status: "In progress", archived: false },
      });
      const [{ id: channel }] = await call(actor, "collab/" + id + "/channels");
      const label = "Completion " + stamp + "-" + i;
      const { id: rule } = await call(actor, root + "/rules", {
        method: "POST", status: 201,
        body: { title: label, message: label, trigger: "task.completed", priority: "Any", active: true },
      });
      tenants.push({ id, root, project, channel, rule, label, owner: actor, messages: new Map() });
    } else {
      const tenant = tenants[i % 3];
      const invite = await call(tenant.owner, tenant.root + "/invitations", {
        method: "POST", status: 201, body: { email, role: "Member" },
      });
      await call(actor, "orgs/accept-invitation", { method: "POST", body: { token: invite.token } });
    }
    const tenant = tenants[i % 3];
    actor.tenant = tenant;
    actor.base = { title: "Deliverable " + i, description: "Iteration planning", status: "In progress",
      projectId: tenant.project, priority: "High", assignee: actor.id };
    actor.task = (await call(actor, tenant.root + "/tasks", {
      method: "POST", status: 201, body: actor.base,
    })).id;
    // Give every board a stable base workload. Only each member's own live task is edited.
    for (let j = 0; j < 8; j++) {
      await call(actor, tenant.root + "/tasks", { method: "POST", status: 201,
        body: { ...actor.base, title: "Backlog " + i + "-" + j, priority: "Low", status: "Planned" } });
    }
    await openChannel(actor);
  }
}

const cycle = ["board", "details", "history", "edit", "notifications", "board", "post", "channels", "board", "edit"];

async function operation(actor, name) {
  const t = actor.tenant;
  const collab = "collab/" + t.id;
  const messages = collab + "/channels/" + t.channel + "/messages";
  switch (name) {
    case "board": {
      const snapshot = await call(actor, t.root + "/snapshot");
      assert.equal(snapshot.projects[0].id, t.project);
      assert.equal(snapshot.tasks.length, 36);
      assert.equal(snapshot.tasks.find(item => item.id === actor.task)?.version, actor.version);
      break;
    }
    case "details": await call(actor, t.root + "/tasks/" + actor.task + "/details"); break;
    case "history": assert.ok(Array.isArray(await call(actor, messages))); break;
    case "notifications": assert.ok(Array.isArray(await call(actor, collab + "/notifications"))); break;
    case "channels": assert.equal((await call(actor, collab + "/channels"))[0].id, t.channel); break;
    case "post": {
      const body = "Progress update " + actor.index + " " + randomUUID();
      const result = await call(actor, messages, { method: "POST", body: { body }, status: 201 });
      assert.equal(result.body, body);
      t.messages.set(result.id, body);
      break;
    }
    case "edit": {
      const status = actor.version % 2 === 0 ? "Completed" : "In progress";
      const result = await call(actor, t.root + "/tasks/" + actor.task, {
        method: "PATCH", body: { ...actor.base, version: actor.version, status },
      });
      assert.equal(result.version, actor.version + 1);
      actor.version = result.version;
      if (status === "Completed") actor.completions++;
      break;
    }
  }
}

async function play(actor) {
  const stagger = actor.index * rampSeconds * 1000 / actors.length;
  const end = timedStart + durationMs - stagger;
  let due = timedStart + stagger;
  let sequence = actor.index;
  while (due < end) {
    await sleep(Math.max(0, due - performance.now()));
    const start = performance.now();
    const name = cycle[sequence++ % cycle.length];
    const sample = { name, phase: phaseAt(start - timedStart), ok: true };
    try { await operation(actor, name); }
    catch (error) {
      sample.ok = false;
      sample.failure = error.message.startsWith("HTTP ") ? error.message : error.name;
    }
    sample.ms = performance.now() - start;
    samples.push(sample);
    due = Math.max(due + periodMs, performance.now());
  }
}

async function reconcile() {
  const started = performance.now();
  let edits = 0, messages = 0, workflows = 0, deliveries = 0;
  for (const t of tenants) {
    const members = actors.filter(a => a.tenant === t);
    const expectedRuns = members.reduce((sum, a) => sum + a.completions, 0);
    const snapshot = await call(t.owner, t.root + "/snapshot");
    for (const actor of members) {
      const task = snapshot.tasks.find(item => item.id === actor.task);
      assert.equal(task.version, actor.version);
      assert.equal(task.status, actor.version % 2 ? "Completed" : "In progress");
      edits += actor.version;
    }
    const history = await call(t.owner, "collab/" + t.id + "/channels/" + t.channel + "/messages");
    assert.equal(history.length, t.messages.size);
    for (const item of history) assert.equal(item.body, t.messages.get(item.id));
    messages += history.length;
    const deadline = performance.now() + 30000;
    for (;;) {
      const runs = (await call(t.owner, t.root + "/executions")).filter(run => run.ruleId === t.rule);
      if (runs.length === expectedRuns && runs.every(run => run.status === "Succeeded")) break;
      if (performance.now() >= deadline) throw Error("Workflow reconciliation timed out");
      await sleep(700);
    }
    for (const actor of members) {
      const notices = await call(actor, "collab/" + t.id + "/notifications");
      assert.equal(notices.filter(n => n.title === t.label).length, actor === t.owner ? expectedRuns : 0);
      assert.equal(actor.deliveries, t.messages.size);
      deliveries += actor.deliveries;
    }
    workflows += expectedRuns;
  }
  return { edits, messages, workflows, socketDeliveries: deliveries, elapsedMs: Math.round(performance.now() - started) };
}

function stats(rows) {
  const sorted = rows.map(r => r.ms).sort((a, b) => a - b);
  const q = (p) => Number(sorted[Math.ceil(p * sorted.length) - 1]?.toFixed(2));
  return { requests: rows.length, failures: rows.filter(r => !r.ok).length, p50Ms: q(.5), p95Ms: q(.95), p99Ms: q(.99), maxMs: q(1) };
}

try {
  await setup();
  console.log("Starting timed traffic across 12 sessions and 3 workspaces.");
  const startedAt = new Date().toISOString();
  timedStart = performance.now();
  await Promise.all(actors.map(play));
  await sleep(Math.max(0, timedStart + durationMs - performance.now()));
  const elapsed = (performance.now() - timedStart) / 1000;
  const byOperation = Object.fromEntries([...new Set(cycle)].map(key => [key, stats(samples.filter(r => r.name === key))]));
  const byPhase = Object.fromEntries(["rampUp", "plateau", "rampDown"].map(key => [key, stats(samples.filter(r => r.phase === key))]));
  const failures = {};
  for (const row of samples.filter(r => !r.ok)) failures[row.failure] = (failures[row.failure] || 0) + 1;
  const thresholds = { readP95Ms: 500, writeP95Ms: 1000, maxFailures: 0,
    minPlateauRequests: Math.floor(plateauSeconds * 1000 * actors.length / periodMs * .95) };
  const summary = { startedAt, runtime: process.version, sessions: 12, tenants: 3, initialTasksPerTenant: 36,
    rampSeconds, plateauSeconds, periodMs, elapsedSeconds: Number(elapsed.toFixed(2)), overall: stats(samples),
    byOperation, byPhase, thresholds, failures };
  try { summary.reconciliation = await reconcile(); }
  catch (error) { summary.reconciliationError = error.message; }
  summary.passed = summary.overall.failures <= thresholds.maxFailures && Boolean(summary.reconciliation) &&
    byPhase.plateau.requests >= thresholds.minPlateauRequests &&
    Object.entries(byOperation).every(([op, s]) => s.requests > 0 &&
      s.p95Ms < (["edit", "post"].includes(op) ? thresholds.writeP95Ms : thresholds.readP95Ms));
  const json = JSON.stringify(summary, null, 2);
  if (process.env.NEXUS_LOAD_REPORT) await writeFile(process.env.NEXUS_LOAD_REPORT, json + "\n");
  console.log(json);
  if (!summary.passed) process.exitCode = 1;
} finally { for (const actor of actors) actor.socket?.disconnect(); }
