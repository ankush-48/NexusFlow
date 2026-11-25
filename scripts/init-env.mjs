import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const model = await readFile(new URL(".env.example", root), "utf8");
const secrets = [
  "NEXUS_WORKER_SECRET",
  "POSTGRES_ADMIN_PASSWORD",
  "CORE_DB_PASSWORD",
  "REALTIME_DB_PASSWORD",
  "MINIO_ROOT_PASSWORD",
  "GRAFANA_ADMIN_PASSWORD",
];
const demo = process.argv.includes("--demo");
const additions = new Map(
  secrets.map((name) => [name, randomBytes(24).toString("hex")]),
);
additions.set("MINIO_ROOT_USER", "nexusflow-" + randomBytes(5).toString("hex"));
if (demo) {
  additions.set("NEXUS_DEMO_PASSWORD", randomBytes(15).toString("hex"));
  additions.set("NEXUS_SEED_COLLAB", "true");
}
const data = model.replace(/^([A-Z_]+)=.*$/gm, (line, name) =>
  additions.has(name) ? name + "=" + additions.get(name) : line,
);
try {
  await writeFile(new URL(".env", root), data, { flag: "wx", mode: 0o600 });
  console.log(
    demo
      ? "Created .env with generated demo credentials. See NEXUS_DEMO_PASSWORD in that file."
      : "Created .env with generated service credentials.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.error(".env already exists. Its settings were retained.");
  process.exitCode = 1;
}
