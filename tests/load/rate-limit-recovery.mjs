import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

export async function verifyLimiterRecovery(stopRedis, startRedis) {
  const origin = new URL(process.env.NEXUS_TEST_URL || "http://127.0.0.1:3000");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  assert.equal(process.env.NEXUS_DISPOSABLE, "1", "Use an isolated test installation.");
  const registration = await fetch(new URL("/api/auth/register", origin), {
    method: "POST",
    headers: { origin: origin.origin, "content-type": "application/json" },
    body: JSON.stringify({ name: "Limiter test", email: randomUUID() + "@example.test", password: randomUUID() }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).verificationRequired, false);
  const cookie = registration.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const endpoint = new URL("/api/auth/me", origin);
  const probe = () => fetch(endpoint, { headers: { cookie }, signal: AbortSignal.timeout(10000) });
  const initial = await probe();
  assert.equal(initial.status, 200);
  const { id } = await initial.json();
  let restartedAt;
  try {
    await stopRedis();
    const blocked = await probe();
    assert.equal(blocked.status, 503);
    assert.match((await blocked.json()).detail, /throttling is temporarily unavailable/);
  } finally {
    restartedAt = performance.now();
    await startRedis();
  }
  while (performance.now() - restartedAt < 45000) {
    const result = await probe();
    if (result.status === 200) {
      assert.equal((await result.json()).id, id);
      const report = { responseDuringOutage: 503, responseAfterRestart: 200,
        restartRequestToVerifiedAccessMs: Math.round(performance.now() - restartedAt), passed: true };
      if (process.env.NEXUS_RECOVERY_REPORT) await writeFile(process.env.NEXUS_RECOVERY_REPORT, JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    await result.body?.cancel();
    assert.equal(result.status, 503);
    await sleep(750);
  }
  throw Error("The gateway did not recover after Redis restarted.");
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
  await verifyLimiterRecovery(
    () => docker("docker", ["compose", "stop", "redis"], options),
    () => docker("docker", ["compose", "up", "-d", "--no-build", "--no-deps", "--wait", "redis"], options),
  );
}
