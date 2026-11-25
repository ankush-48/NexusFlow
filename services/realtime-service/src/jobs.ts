import { Injectable, Logger, OnApplicationShutdown } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { Kafka, type Consumer, type Producer } from "kafkajs";
import { config } from "./config.js";
import {
  deliveriesSchema,
  eventSchema,
  taskChanged,
  type DomainEvent,
} from "./contracts.js";
import { Live } from "./socket.js";
import { Store } from "./store.js";

const topic = "nexusflow.domain.v1";
const queueName = "nexusflow-workflows";

@Injectable()
export class Jobs implements OnApplicationShutdown {
  private readonly logger = new Logger(Jobs.name);
  private consumer?: Consumer;
  private producer?: Producer;
  private queue?: Queue<DomainEvent>;
  private worker?: Worker<DomainEvent>;
  private redis?: Redis;
  private workerRedis?: Redis;

  constructor(
    private readonly store: Store,
    private readonly live: Live,
  ) {}

  async connect() {
    if (!config.brokers.length) return;
    if (!config.redis || config.workerSecret.length < 32)
      throw new Error(
        "Kafka workflow processing requires Redis and a worker secret of at least 32 characters.",
      );
    const kafka = new Kafka({
      clientId: "nexusflow-realtime",
      brokers: config.brokers,
      retry: { retries: 8, initialRetryTime: 300 },
    });
    this.consumer = kafka.consumer({ groupId: "nexusflow-workflows-v1" });
    this.producer = kafka.producer();
    this.redis = new Redis(config.redis, { maxRetriesPerRequest: 3 });
    this.workerRedis = new Redis(config.redis, { maxRetriesPerRequest: null });
    this.queue = new Queue<DomainEvent>(queueName, { connection: this.redis });
    this.worker = new Worker<DomainEvent>(
      queueName,
      async (job) => {
        try {
          await this.process(job.data);
        } catch (error) {
          if (job.attemptsMade + 1 >= (job.opts.attempts || 1)) {
            await this.deadLetter(
              job.id ?? "",
              JSON.stringify(job.data),
              "workflow retries exhausted",
            );
          }
          throw error;
        }
      },
      { connection: this.workerRedis, concurrency: 4 },
    );
    this.worker.on("error", (error) => this.logger.error(error.message));
    this.worker.on("failed", (job, error) =>
      this.logger.warn(
        "Workflow job " + (job?.id ?? "unknown") + " failed: " + error.message,
      ),
    );
    await this.producer.connect();
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const body = message.value?.toString() ?? "";
        let raw: unknown;
        try {
          raw = JSON.parse(body);
        } catch {
          raw = null;
        }
        const parsed = eventSchema.safeParse(raw);
        if (!parsed.success) {
          await this.deadLetter(
            message.key?.toString() ?? "",
            body,
            "invalid event envelope",
          );
          return;
        }
        await this.queue?.add(parsed.data.type, parsed.data, {
          jobId: parsed.data.id,
          attempts: 5,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: { age: 604800, count: 100000 },
          removeOnFail: { age: 2592000, count: 10000 },
        });
      },
    });
  }

  private async process(event: DomainEvent) {
    const deliveries = deliveriesSchema.parse(await this.core(event, false));
    for (const delivery of deliveries) {
      const projectId = String(event.payload.projectId ?? "");
      const href = /^[a-fA-F0-9-]{36}$/.test(projectId)
        ? "/projects/" + projectId
        : null;
      const result = await this.store.pool.query(
        "INSERT INTO notifications(id,org_id,user_id,title,href) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [delivery.id, event.orgId, delivery.userId, delivery.title, href],
      );
      if (result.rowCount) this.live.notification(event.orgId, delivery.userId);
      const preferences = await this.store.pool.query(
        "SELECT email FROM notification_preferences WHERE org_id=$1 AND user_id=$2",
        [event.orgId, delivery.userId],
      );
      if (preferences.rows[0]?.email) {
        const response = await fetch(config.core + "/internal/workflow-email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-worker-secret": config.workerSecret,
          },
          body: JSON.stringify({ ...delivery, orgId: event.orgId, href }),
          signal: AbortSignal.timeout(7000),
        });
        if (!response.ok)
          throw new Error("Workflow email returned HTTP " + response.status);
      }
    }
    if (deliveries.length) await this.core(event, true);
    if (taskChanged(event.type)) this.live.task(event.orgId);
    this.logger.log(
      JSON.stringify({
        eventId: event.id,
        correlationId: event.correlationId,
        type: event.type,
        deliveries: deliveries.length,
      }),
    );
  }

  private async core(event: DomainEvent, delivered: boolean) {
    const response = await fetch(config.core + "/internal/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-secret": config.workerSecret,
        "x-correlation-id": event.correlationId,
      },
      body: JSON.stringify({ ...event, delivered }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new Error("Core event handling returned HTTP " + response.status);
    return response.json();
  }

  private async deadLetter(key: string, value: string, reason: string) {
    await this.producer?.send({
      topic: "nexusflow.domain.dlq.v1",
      messages: [{ key, value, headers: { reason } }],
    });
  }

  async onApplicationShutdown() {
    await this.consumer?.disconnect();
    await this.worker?.close();
    await this.queue?.close();
    await this.producer?.disconnect();
    this.redis?.disconnect();
    this.workerRedis?.disconnect();
  }
}
