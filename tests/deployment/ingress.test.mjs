import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const source = new URL("../../infrastructure/nginx/", import.meta.url);
const smoke = fileURLToPath(new URL("../../scripts/smoke-ingress.mjs", import.meta.url));
const executable = process.env.NGINX_BINARY || "nginx";
const temp = await mkdtemp(join(process.env.NEXUS_TEST_TMP || tmpdir(), "nexus-ingress-"));
const observed = new Map();

function fixture(name) {
  return createServer((req, res) => {
    const path = new URL(req.url, "http://local.test").pathname;
    observed.set(path, { name, headers: req.headers });
    if (path === "/actuator/health/readiness") return res.end('{"status":"UP"}');
    if (path === "/socket.io/") return res.end('0{"sid":"test-session"}');
    if (path === "/api/auth/me") {
      res.writeHead(401, { "cache-control": "no-store", "x-correlation-id": "ingress-test" });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html></html>");
  });
}
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
const web = fixture("web");
const gateway = fixture("gateway");
try {
  await mkdir(join(temp, "logs"));
  await mkdir(join(temp, "temp"));
  const webPort = await listen(web);
  const gatewayPort = await listen(gateway);
  const reserve = createServer();
  const port = await listen(reserve);
  await new Promise(resolve => reserve.close(resolve));
  const base = "http://127.0.0.1:" + port;
  const common = (await readFile(new URL("default.conf", source), "utf8"))
    .replace("listen 80;", "listen 127.0.0.1:" + port + ";")
    .replaceAll("web:3000", "127.0.0.1:" + webPort)
    .replaceAll("gateway:8080", "127.0.0.1:" + gatewayPort)
    .replace("/var/log/nginx/access.log", "logs/access.log");

  for (const profile of ["local", "aws", "aws-loopback-alb"]) {
    const aws = profile.startsWith("aws");
    let policy = await readFile(new URL(aws ? "ingress-aws.conf" : "ingress-local.conf", source), "utf8");
    // Give the test's loopback sender the role of the ALB for this case only.
    if (profile === "aws-loopback-alb") policy += "\nset_real_ip_from 127.0.0.1;";
    const config = [
      "daemon off; master_process off; pid logs/nginx.pid; error_log logs/error.log; events {}",
      "http { client_body_temp_path temp/body; proxy_temp_path temp/proxy;",
      "fastcgi_temp_path temp/fastcgi; uwsgi_temp_path temp/uwsgi; scgi_temp_path temp/scgi;",
      policy, common, "}",
    ].join("\n");
    await writeFile(join(temp, "test.conf"), config);
    const args = ["-p", temp.replaceAll("\\", "/") + "/", "-c", "test.conf"];
    const check = spawnSync(executable, [...args, "-t"], { cwd: temp, encoding: "utf8", windowsHide: true });
    if (check.error) throw check.error;
    assert.equal(check.status, 0, check.stderr);
    const nginx = spawn(executable, args, { cwd: temp, windowsHide: true, stdio: "ignore" });
    const stopped = once(nginx, "exit");
    try {
      for (let attempt = 0; ; attempt++) {
        try { await fetch(base + "/health"); break; }
        catch (error) {
          if (attempt >= 100 || nginx.exitCode !== null) throw error;
          await delay(50);
        }
      }
      for (const path of ["/", "/api/auth/me", "/socket.io"]) {
        const response = await fetch(base + path + "?check=sample-query", { headers: {
          "x-forwarded-for": "192.0.2.7, 198.51.100.8",
          "x-nexusflow-client-ip": "192.0.2.7",
        } });
        const seen = observed.get(path === "/socket.io" ? "/socket.io/" : path);
        const ip = profile === "aws-loopback-alb" ? "198.51.100.8" : "127.0.0.1";
        assert.equal(seen.name, path === "/" ? "web" : "gateway");
        assert.equal(seen.headers["x-nexusflow-client-ip"], ip);
        assert.equal(seen.headers["x-forwarded-for"], ip);
        assert.equal(seen.headers["x-forwarded-proto"], aws ? "https" : "http");
        assert.equal(response.headers.get("strict-transport-security"), aws ? "max-age=31536000" : null);
      }
      const run = spawn(process.execPath, [smoke, base, "--http-only"], { windowsHide: true, stdio: "inherit" });
      assert.equal((await once(run, "exit"))[0], 0);
      console.log("PASS Nginx " + profile + " ingress policy and route identity.");
    } finally {
      // The isolated test runs one process. Stop exactly that child.
      if (nginx.exitCode === null) nginx.kill();
      await stopped;
    }
  }
  const accessLog = await readFile(join(temp, "logs/access.log"), "utf8");
  assert.match(accessLog, /GET \/api\/auth\/me /);
  assert.ok(!accessLog.includes("sample-query"), "Access log must omit query values.");
} finally {
  for (const server of [web, gateway]) { server.closeAllConnections(); server.close(); }
  await rm(temp, { recursive: true, force: true });
}
