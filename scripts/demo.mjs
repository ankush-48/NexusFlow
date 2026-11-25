import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const { values } = parseArgs({ options: { port: { type: "string" } } });
const port = values.port ?? process.env.PORT ?? "3000";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  console.error("Choose a demo port from 1 to 65535.");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const runner = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: fileURLToPath(new URL("../apps/web/", import.meta.url)),
    env: { ...process.env, NEXUS_DEMO: "1", NEXUS_DIST: ".next-demo", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "inherit",
  },
);
runner.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
runner.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
