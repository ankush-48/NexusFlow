import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.NEXUS_TEST_URL || "http://127.0.0.1:3000";
const inboxUrl = process.env.NEXUS_TEST_SMTP;
if (!inboxUrl) throw new Error("Set NEXUS_TEST_SMTP to a local SMTP capture inbox URL.");
const email = "mailcheck-" + randomUUID().slice(0, 12) + "@example.test";
const password = "Mail-test-" + randomUUID();
async function request(path, status, data, cookie = "") {
  const response = await fetch(base + "/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { cookie, ...(data === undefined ? {} : { "content-type": "application/json" }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  assert.equal(response.status, status, path);
  return response;
}
async function token(kind) {
  const messages = await fetch(inboxUrl).then(response => response.json());
  const route = kind === "verify" ? "/login?verify=" : "/forgot-password?reset=";
  const link = new URL(route, base).href;
  const escapedLink = link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escapedLink + "([A-Za-z0-9_-]{43})");
  const found = messages.findLast(message => message.includes(email) && pattern.test(message));
  assert.ok(found, "The " + kind + " email did not arrive in the local inbox.");
  return found.match(pattern)[1];
}

const registration = await request("auth/register", 201, { name: "Mail QA", email, password });
assert.equal((await registration.json()).verificationRequired, true);
await request("auth/login", 403, { email, password });
const verify = await token("verify");
await request("auth/verify", 204, { token: verify });
await request("auth/verify", 400, { token: verify });
const login = await request("auth/login", 200, { email, password });
const cookies = login.headers.getSetCookie();
assert.equal(cookies.length, 2);
for (const cookie of cookies) {
  assert.match(cookie, /;\s*HttpOnly\b/i);
  assert.match(cookie, /;\s*SameSite=Lax\b/i);
  if (new URL(base).protocol === "https:") assert.match(cookie, /;\s*Secure\b/i);
}
assert.match(cookies.find(cookie => cookie.startsWith("nf_refresh=")) ?? "", /;\s*Path=\/api\/auth\b/i);
const session = cookies.map(cookie => cookie.split(";")[0]).join("; ");
await request("auth/forgot-password", 204, { email });
const reset = await token("reset");
await request("auth/reset-password", 204, { token: reset, password: password + "-new" });
await request("auth/reset-password", 400, { token: reset, password: password + "-new" });
await request("auth/me", 401, undefined, session);
await request("auth/login", 200, { email, password: password + "-new" });
console.log("PASS email verification, password reset, token replay rejection and session revocation against local SMTP capture.");
