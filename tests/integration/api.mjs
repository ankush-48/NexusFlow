import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";

const base = process.env.NEXUS_TEST_URL || "http://127.0.0.1:3000";
const stamp = randomUUID().slice(0, 12);
const password = "Integration-" + randomUUID() + "-password";
const cookieHeader = (jar) =>
  [...jar].map(([key, value]) => key + "=" + value).join("; ");
async function request(
  path,
  { method = "GET", body, jar = new Map(), status = 200, headers = {} } = {},
) {
  const response = await fetch(base + "/api/" + path, {
    method,
    headers: {
      cookie: cookieHeader(jar),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, status, path + " " + JSON.stringify(data));
  for (const cookie of response.headers.getSetCookie()) {
    const [key, value] = cookie.split(";")[0].split("=");
    if (value) jar.set(key, value);
    else jar.delete(key);
  }
  return data;
}

async function account(name) {
  const email = name.toLowerCase() + "-" + stamp + "@example.test";
  const jar = new Map();
  const registration = await request("auth/register", {
    method: "POST",
    body: { name, email, password },
    status: 201,
    jar,
  });
  assert.equal(
    registration.verificationRequired,
    false,
    "Use NEXUS_VERIFY_EMAIL=false in the test stack.",
  );
  // Browsers can retain their refresh cookie after the access cookie expires.
  jar.delete("nf_access");
  const endedSession = new Map(jar);
  await request("auth/logout", { method: "POST", status: 204, jar });
  assert.equal(jar.size, 0);
  await request("auth/refresh", { method: "POST", status: 401, jar: endedSession });
  await request("auth/login", {
    method: "POST",
    body: { email, password },
    jar,
  });
  return { email, jar };
}
function connect(jar) {
  return io(base, {
    extraHeaders: { Cookie: cookieHeader(jar), Origin: base },
    transports: ["websocket"],
    reconnection: false,
    timeout: 7000,
  });
}
function signal(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out awaiting " + event)),
      7000,
    );
    socket.once(event, (...args) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

const alice = await account("Alice");
const bob = await account("Bob");
const carol = await account("Carol");
const user = await request("auth/me", { jar: alice.jar });
const stale = new Map(alice.jar);
await request("auth/refresh", { method: "POST", jar: alice.jar, status: 204 });
await request("auth/refresh", { method: "POST", jar: stale, status: 401 });
await request("auth/me", { jar: stale, status: 401 });

const { id: org } = await request("orgs", {
  method: "POST",
  body: { name: "QA " + stamp },
  status: 201,
  jar: alice.jar,
});
const { id: other } = await request("orgs", {
  method: "POST",
  body: { name: "Private " + stamp },
  status: 201,
  jar: carol.jar,
});
await request("orgs/" + org + "/snapshot", { jar: carol.jar, status: 403 });
await request("orgs/" + other + "/snapshot", { jar: alice.jar, status: 403 });
const invite = await request("orgs/" + org + "/invitations", {
  method: "POST",
  body: { email: bob.email, role: "Viewer" },
  status: 201,
  jar: alice.jar,
});
await request("orgs/accept-invitation", {
  method: "POST",
  body: { token: invite.token },
  jar: carol.jar,
  status: 404,
});
await request("orgs/accept-invitation", {
  method: "POST",
  body: { token: invite.token },
  jar: bob.jar,
});
await request("orgs/accept-invitation", {
  method: "POST",
  body: { token: invite.token },
  jar: bob.jar,
  status: 404,
});

const projectBody = {
  title: "Integration project",
  description: "Persisted through the gateway",
  status: "Planned",
  priority: "High",
  team: "Product",
  owner: user.id,
  startDate: null,
  dueDate: null,
  archived: false,
};
const projects = "orgs/" + org + "/projects";
const { id: project } = await request(projects, {
  method: "POST",
  body: projectBody,
  status: 201,
  jar: alice.jar,
});
await request(projects, {
  method: "POST",
  body: projectBody,
  status: 403,
  jar: bob.jar,
});
await request(projects + "/" + project, {
  method: "PATCH",
  body: projectBody,
  status: 403,
  jar: carol.jar,
});
await request("orgs/" + other + "/projects/" + project, {
  method: "PATCH",
  body: { ...projectBody, owner: null },
  status: 404,
  jar: carol.jar,
});
await request(projects, {
  method: "POST",
  body: projectBody,
  status: 403,
  jar: alice.jar,
  headers: { Origin: "https://untrusted.example" },
});

const tasks = "orgs/" + org + "/tasks";
const taskBody = {
  projectId: project,
  title: "Concurrent task",
  description: "Two editors start with version zero",
  status: "Planned",
  priority: "High",
  assignee: user.id,
  dueDate: null,
};
const { id: task } = await request(tasks, {
  method: "POST",
  body: taskBody,
  jar: alice.jar,
  status: 201,
});
await request("orgs/" + other + "/tasks", {
  method: "POST",
  body: { ...taskBody, assignee: null },
  jar: carol.jar,
  status: 400,
});
const update = (status) =>
  fetch(base + "/api/" + tasks + "/" + task, {
    method: "PATCH",
    headers: {
      cookie: cookieHeader(alice.jar),
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...taskBody, status, version: 0 }),
  });
const concurrent = await Promise.all([
  update("In progress"),
  update("Completed"),
]);
assert.deepEqual(concurrent.map((value) => value.status).sort(), [200, 409]);
const actual = await request("orgs/" + org + "/snapshot", { jar: bob.jar });
assert.equal(actual.tasks.find((item) => item.id === task).version, 1);
await request(tasks + "/" + task + "/comments", {
  method: "POST",
  body: { body: "Integration comment" },
  jar: alice.jar,
  status: 201,
});
assert.equal(
  (await request(tasks + "/" + task + "/comments", { jar: bob.jar }))[0].body,
  "Integration comment",
);
await request("orgs/" + other + "/tasks/" + task + "/comments", {
  jar: carol.jar,
  status: 404,
});

const channels = "collab/" + org + "/channels";
const [general] = await request(channels, { jar: alice.jar });
await request("collab/" + other + "/channels/" + general.id + "/messages", {
  jar: carol.jar,
  status: 404,
});
const unauthenticated = connect(new Map());
const member = connect(bob.jar);
const outsider = connect(carol.jar);
try {
  const failed = await signal(unauthenticated, "connect_error");
  assert.match(String(failed[0]), /Sign in/);
  await Promise.all([
    member.connected || signal(member, "connect"),
    outsider.connected || signal(outsider, "connect"),
  ]);
  assert.deepEqual(
    await member
      .timeout(5000)
      .emitWithAck("channel.join", { orgId: org, channelId: general.id }),
    { ok: true },
  );
  assert.deepEqual(
    await outsider
      .timeout(5000)
      .emitWithAck("channel.join", { orgId: org, channelId: general.id }),
    { ok: false },
  );
  let leaked = false;
  outsider.on("message.created", () => {
    leaked = true;
  });
  const event = signal(member, "message.created");
  const body = "Socket and database integration " + stamp;
  await request(channels + "/" + general.id + "/messages", {
    method: "POST",
    body: { body },
    jar: alice.jar,
    status: 201,
  });
  await event;
  const messages = await request(channels + "/" + general.id + "/messages", {
    jar: bob.jar,
  });
  assert.ok(messages.some((message) => message.body === body));
  assert.equal(leaked, false);
} finally {
  for (const socket of [unauthenticated, member, outsider]) socket.disconnect();
}
const billed = await request("orgs/" + org + "/billing", {
  method: "PATCH",
  body: { plan: "Professional" },
  jar: alice.jar,
});
assert.equal(billed.provider, "mock");
assert.equal(
  (await request("orgs/" + org + "/snapshot", { jar: alice.jar })).invoices[0]
    .amount,
  2400,
);
await request("admin", { jar: bob.jar, status: 403 });
console.log(
  "PASS registration, refresh rotation, tenant isolation, invitations, role restrictions, task concurrency, comments, authenticated WebSocket room delivery, and mock billing.",
);

const second = await request(tasks, {
  method: "POST",
  status: 201,
  jar: alice.jar,
  body: { ...taskBody, title: "Prerequisite task" },
});
const subtask = await request(tasks + "/" + task + "/subtasks", {
  method: "POST",
  status: 201,
  jar: alice.jar,
  body: { title: "Coordinate test" },
});
await request(tasks + "/" + task + "/subtasks/" + subtask.id, {
  method: "PATCH",
  status: 204,
  jar: alice.jar,
  body: { done: true },
});
await request(tasks + "/" + task + "/dependencies", {
  method: "POST",
  status: 201,
  jar: alice.jar,
  body: { prerequisiteId: second.id },
});
await request(tasks + "/" + second.id + "/dependencies", {
  method: "POST",
  status: 409,
  jar: alice.jar,
  body: { prerequisiteId: task },
});
await request(tasks + "/" + task + "/labels", {
  method: "POST",
  status: 201,
  jar: alice.jar,
  body: { name: "QA label" },
});
const details = await request(tasks + "/" + task + "/details", {
  jar: bob.jar,
});
assert.equal(details.subtasks[0].done, true);
assert.deepEqual(details.labels, ["qa label"]);
assert.equal(details.dependencies[0].id, second.id);
await request(tasks + "/bulk", {
  method: "POST",
  status: 409,
  jar: alice.jar,
  body: {
    tasks: [
      { id: second.id, version: 0 },
      { id: task, version: 0 },
    ],
    status: "Completed",
  },
});
const after = await request("orgs/" + org + "/snapshot", { jar: alice.jar });
assert.equal(after.tasks.find((item) => item.id === second.id).version, 0);
await request(tasks + "/bulk", {
  method: "POST",
  status: 204,
  jar: alice.jar,
  body: {
    tasks: [
      { id: second.id, version: 0 },
      { id: task, version: 1 },
    ],
    status: "Completed",
  },
});
const department = await request("orgs/" + org + "/directory/departments", {
  method: "POST",
  status: 201,
  jar: alice.jar,
  body: { name: "Engineering" },
});
const team = await request("orgs/" + org + "/directory/teams", {
  method: "POST",
  status: 201,
  jar: alice.jar,
  body: { name: "Release", departmentId: department.id },
});
await request("orgs/" + org + "/directory/teams/" + team.id + "/members", {
  method: "PATCH",
  status: 204,
  jar: alice.jar,
  body: { userId: user.id, assigned: true },
});
const directory = await request("orgs/" + org + "/directory", { jar: bob.jar });
assert.deepEqual(JSON.parse(directory.teams[0].memberIds), [user.id]);

const carolInvite = await request("orgs/" + org + "/invitations", {
  method: "POST",
  status: 201,
  jar: alice.jar,
  body: { email: carol.email, role: "Member" },
});
await request("orgs/accept-invitation", {
  method: "POST",
  jar: carol.jar,
  body: { token: carolInvite.token },
});
const bobUser = await request("auth/me", { jar: bob.jar });
const direct = await request(channels, {
  method: "POST",
  status: 201,
  jar: alice.jar,
  body: { name: "private-test", kind: "direct", members: [bobUser.id] },
});
const privatePath = channels + "/" + direct.id + "/messages";
assert.ok(
  (await request(channels, { jar: bob.jar })).some(
    (channel) => channel.id === direct.id,
  ),
);
assert.ok(
  !(await request(channels, { jar: carol.jar })).some(
    (channel) => channel.id === direct.id,
  ),
);
await request(privatePath, { jar: carol.jar, status: 404 });
const msg = await request(privatePath, {
  method: "POST",
  status: 201,
  jar: alice.jar,
  body: { body: "Private discussion " + stamp },
});
await request(privatePath + "/" + msg.id, {
  method: "PATCH",
  jar: alice.jar,
  body: { body: "Edited private discussion " + stamp },
});
await request(privatePath + "/" + msg.id + "/reaction", {
  method: "PATCH",
  jar: alice.jar,
  body: { emoji: "👍", active: true },
});
await request(channels + "/" + direct.id + "/read", {
  method: "PATCH",
  jar: bob.jar,
});
const privateMessages = await request(privatePath, { jar: alice.jar });
assert.equal(privateMessages[0].readCount, 1);
assert.equal(privateMessages[0].reactions[0].count, 1);
const search =
  "collab/" + org + "/search?q=" + encodeURIComponent("Edited private");
assert.equal((await request(search, { jar: carol.jar })).length, 0);
assert.equal((await request(search, { jar: bob.jar }))[0].id, msg.id);
await request(privatePath + "/" + msg.id, { method: "DELETE", jar: alice.jar });
assert.deepEqual(await request(privatePath, { jar: alice.jar }), []);
console.log(
  "PASS task metadata, transactional bulk rollback, team directory, private conversation isolation, search, reactions, edits and receipts.",
);

if (process.env.NEXUS_TEST_WORKFLOWS === "1") {
  const title = "Integration workflow " + stamp;
  if(process.env.NEXUS_TEST_SMTP) {
    const prefs=await request("collab/"+org+"/notification-preferences",{method:"PATCH",jar:alice.jar,body:{email:true}});
    assert.equal(prefs.email,true);
  }
  const { id: rule } = await request("orgs/" + org + "/rules", {
    method: "POST",
    status: 201,
    jar: alice.jar,
    body: {
      title,
      trigger: "task.created",
      priority: "High",
      message: title,
      active: true,
    },
  });
  await request(tasks, {
    method: "POST",
    status: 201,
    jar: alice.jar,
    body: { ...taskBody, title: "Queue delivery " + stamp },
  });
  const deadline = Date.now() + 45_000;
  let delivered = false;
  while (Date.now() < deadline) {
    const [executions, notices] = await Promise.all([
      request("orgs/" + org + "/executions", { jar: alice.jar }),
      request("collab/" + org + "/notifications", { jar: alice.jar }),
    ]);
    if (
      executions.some(
        (run) => run.ruleId === rule && run.status === "Succeeded",
      ) &&
      notices.some((item) => item.title === title)
    ) {
      delivered = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  assert.ok(
    delivered,
    "Kafka workflow notification did not finish in 45 seconds.",
  );
  console.log(
    "PASS transactional outbox, Kafka, BullMQ, workflow execution and durable notification delivery.",
  );
}

if (process.env.NEXUS_TEST_ATTACHMENTS === "1") {
  const endpoint = base + "/api/" + tasks + "/" + task + "/attachments";
  const form = new FormData();
  const contents = "NexusFlow signed storage test " + stamp;
  form.append(
    "file",
    new Blob([contents], { type: "text/plain" }),
    "verification.txt",
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { cookie: cookieHeader(alice.jar) },
    body: form,
  });
  const file = await response.json();
  assert.equal(response.status, 201, JSON.stringify(file));
  const download = await fetch(endpoint + "/" + file.id, {
    headers: { cookie: cookieHeader(bob.jar) },
  });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /attachment/);
  assert.equal(await download.text(), contents);
  await request(
    "orgs/" + other + "/tasks/" + task + "/attachments/" + file.id,
    { jar: carol.jar, status: 404 },
  );
  console.log(
    "PASS authenticated S3-compatible attachment upload, download, and cross-tenant rejection.",
  );
}
