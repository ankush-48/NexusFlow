// Logical backup and restore rehearsal for the two NexusFlow PostgreSQL databases.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pg from "pg";

const [mode, location] = process.argv.slice(2);
const names = {
  core: process.env.NEXUS_CORE_DATABASE || "nexusflow",
  realtime: process.env.NEXUS_REALTIME_DATABASE || "nexusflow_realtime",
};
const required = { core: ["organizations", "tasks", "projects", "users"], realtime: ["channels", "messages"] };
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const schemas = ["core", "realtime"];

async function connect(database) {
  const options = { database, application_name: "nexusflow-recovery", connectionTimeoutMillis: 10000 };
  if (process.env.PGSSLMODE === "verify-full") {
    options.ssl = { rejectUnauthorized: true };
    if (process.env.PGSSLROOTCERT) options.ssl.ca = await readFile(process.env.PGSSLROOTCERT);
  }
  const client = new pg.Client(options);
  await client.connect();
  return client;
}

async function postgresTool(name, args, database) {
  const executable = process.env.PG_BIN ? join(process.env.PG_BIN, name) : name;
  const child = spawn(executable, args, {
    env: { ...process.env, PGDATABASE: database, PGCONNECT_TIMEOUT: "10" },
    stdio: ["ignore", "ignore", "inherit"], windowsHide: true,
  });
  await new Promise((done, fail) => {
    child.once("error", fail);
    child.once("close", (code) => code === 0 ? done() : fail(new Error(name + " failed (" + code + ").")));
  });
}

async function fileDigest(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}

async function fingerprint(client, label) {
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
  await client.query("SET LOCAL extra_float_digits = 3");
  const { rows: tables } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename COLLATE \"C\"",
  );
  if (!required[label].every((name) => tables.some((row) => row.tablename === name)))
    throw new Error("Missing required NexusFlow tables in " + label + ".");
  const results = [];
  for (const { tablename } of tables) {
    // Sort fixed-size row hashes in PostgreSQL, then stream them in bounded batches.
    await client.query(`DECLARE nf_rows NO SCROLL CURSOR FOR
      SELECT sha256(convert_to(to_jsonb(r)::text, 'UTF8')) AS digest
      FROM public.${quote(tablename)} r ORDER BY 1`);
    const hash = createHash("sha256");
    let count = 0;
    while (true) {
      const { rows } = await client.query("FETCH FORWARD 2048 FROM nf_rows");
      for (const row of rows) hash.update(row.digest);
      count += rows.length;
      if (rows.length < 2048) break;
    }
    await client.query("CLOSE nf_rows");
    results.push({ table: tablename, rows: count, sha256: hash.digest("hex") });
  }
  return results;
}

async function backup(folder) {
  await mkdir(folder, { mode: 0o700 }); // Refuse to overwrite an existing backup.
  const manifest = { format: 1, startedAt: new Date().toISOString(), stores: {} };
  for (const label of schemas) {
    const path = join(folder, label + ".dump");
    const client = await connect(names[label]);
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const { rows: [row] } = await client.query("SELECT pg_export_snapshot() AS snapshot");
      await postgresTool("pg_dump", ["--no-password", "--format=custom", "--snapshot", row.snapshot, "--file", path], names[label]);
      const tables = await fingerprint(client, label);
      await client.query("COMMIT");
      manifest.stores[label] = { sha256: await fileDigest(path), tables };
    } finally { await client.end(); }
  }
  manifest.finishedAt = new Date().toISOString();
  await writeFile(join(folder, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
  console.log("Created core and collaboration backups with matching snapshot fingerprints.");
}

async function rehearse(folder) {
  const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
  if (manifest.format !== 1) throw new Error("Unsupported backup manifest.");
  for (const label of schemas) {
    if (await fileDigest(join(folder, label + ".dump")) !== manifest.stores[label]?.sha256)
      throw new Error("Backup checksum mismatch for " + label + ".");
  }
  const suffix = randomUUID().replaceAll("-", "");
  const admin = await connect(process.env.NEXUS_MAINTENANCE_DB || "postgres");
  try {
    for (const label of schemas) {
      const target = "nf_drill_" + label + "_" + suffix;
      const identifier = quote(target);
      await admin.query("CREATE DATABASE " + identifier + " WITH TEMPLATE template0 ALLOW_CONNECTIONS false");
      console.log("Created isolated rehearsal database " + target);
      await admin.query("REVOKE CONNECT ON DATABASE " + identifier + " FROM PUBLIC");
      await admin.query("ALTER DATABASE " + identifier + " ALLOW_CONNECTIONS true");
      await postgresTool("pg_restore", ["--no-password", "--single-transaction", "--exit-on-error", "--no-owner",
        "--no-privileges", "--dbname", target, join(folder, label + ".dump")], target);
      const client = await connect(target);
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const tables = await fingerprint(client, label);
        await client.query("COMMIT");
        if (JSON.stringify(tables) !== JSON.stringify(manifest.stores[label].tables))
          throw new Error("Restored table fingerprints differ in " + label + ".");
        console.log(label + " verified: " + tables.length + " tables, " + tables.reduce((n, t) => n + t.rows, 0) + " rows.");
      } finally { await client.end(); }
    }
  } finally { await admin.end(); }
}

try {
  if (!location || !["backup", "rehearse"].includes(mode))
    throw new Error("Usage: node scripts/db-recovery.mjs <backup|rehearse> <backup-directory>");
  for (const name of Object.values(names))
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name)) throw new Error("Set a plain PostgreSQL database name.");
  if (mode === "backup") await backup(resolve(location)); else await rehearse(resolve(location));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
