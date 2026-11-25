import { spawnSync } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const app = new URL("apps/web/", root);
const result = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), "build"], {
  cwd: fileURLToPath(app),
  env: { ...process.env, NEXT_PUBLIC_NEXUS_STATIC: "1", NEXT_TELEMETRY_DISABLED: "1", NEXUS_DIST: "" },
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await copyFile(new URL("docs/demo.webm", root), new URL("out/walkthrough.webm", app));
