export const config = {
  port: Number(process.env.REALTIME_PORT || 4000),
  origin: process.env.NEXUS_ORIGIN || "http://localhost:3000",
  core: process.env.CORE_URL || "http://localhost:8081",
  database: process.env.REALTIME_DB_URL,
  redis: process.env.REDIS_URL,
  brokers: (process.env.KAFKA_BROKERS || "").split(",").filter(Boolean),
  workerSecret: process.env.NEXUS_WORKER_SECRET || "",
  demo: process.env.NEXUS_SEED_COLLAB === "true",
};
