import { z } from "zod";

export const eventSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  orgId: z.uuid(),
  type: z.string().min(1).max(80),
  correlationId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  occurredAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export const deliveriesSchema = z.array(
  z.object({
    id: z.uuid(),
    userId: z.uuid(),
    title: z.string().min(1).max(500),
  }),
);
export type DomainEvent = z.infer<typeof eventSchema>;
export const taskChanged = (type: string) =>
  ["task.created", "task.updated", "task.completed"].includes(type);
