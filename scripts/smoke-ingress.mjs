import assert from "node:assert/strict";
import { io } from "socket.io-client";

const origin = new URL(process.argv[2] ?? "http://localhost:3000");
async function get(path, expected) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10000), redirect: "manual" });
  assert.equal(response.status, expected, path + " returned " + response.status);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  if (origin.protocol === "https:") assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=[1-9]/);
  return response;
}
assert.match((await get("/", 200)).headers.get("content-type") ?? "", /text\/html/);
assert.equal((await (await get("/health", 200)).json()).status, "UP");
const privateRoute = await get("/api/auth/me", 401);
assert.match(privateRoute.headers.get("cache-control") ?? "", /no-store/);
assert.ok(privateRoute.headers.get("x-correlation-id"), "The gateway must return a request ID.");
const handshake = await (await get("/socket.io/?EIO=4&transport=polling", 200)).text();
assert.equal(handshake[0], "0");
assert.ok(JSON.parse(handshake.slice(1)).sid, "Expected an Engine.IO opening packet.");
if (process.argv[3] !== "--http-only") {
  const socket = io(origin.origin, { transports: ["websocket"], reconnection: false, timeout: 5000,
    autoConnect: false, extraHeaders: { Origin: origin.origin } });
  try {
    const result = await new Promise((resolve) => {
      socket.once("connect", () => resolve("unexpected authenticated connection"));
      socket.once("connect_error", (error) => resolve(error.message));
      socket.connect();
    });
    assert.equal(result, "Sign in to continue.", "The WebSocket upgrade must reach the Socket.IO session check.");
  } finally {
    socket.disconnect();
  }
}
await get("/actuator/prometheus", 404);
await get("/internal/events", 404);
console.log("PASS workspace, readiness, session boundary, realtime handshake and private route checks through ingress.");
