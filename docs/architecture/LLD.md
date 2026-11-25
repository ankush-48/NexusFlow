# Low-level design

## Authentication and authorization

The core hashes passwords with BCrypt and rejects passwords beyond BCrypt's 72-byte limit. The 256-bit opaque access and refresh tokens are generated independently and stored only as SHA-256 hashes. The access cookie expires after 15 minutes. Refresh rotates both values atomically against the previous refresh hash, and the session has a fixed 14-day lifetime. Logout, password reset, account suspension, and explicit session revocation invalidate stored sessions.

The gateway applies exact-origin CORS and Redis request counters. Spring and NestJS also reject requests with an unrelated Origin or cross-site fetch metadata. Cookies are HttpOnly and SameSite=Lax. The AWS override requires HTTPS and secure cookies. Signed billing webhooks use their own authentication.

| Action | Allowed roles |
| --- | --- |
| Read organization records | Any authenticated organization member |
| Create or edit projects and workflows | Owner, Admin, Project Manager |
| Create or modify tasks, comments or messages | Any organization membership with write access |
| Create departments, teams, and invitations | Owner and Admin |
| Assign or invite administrators, change billing | Workspace owner |
| Suspend a user from the platform | Platform administrator |

Private conversations additionally require per-conversation membership. Core SQL uses composite foreign keys for references between tenant-owned records. The services have separate database roles.

## Consistency and failure handling

- Task writes lock the tenant-scoped task row and check the client version. A stale write returns HTTP 409. Bulk changes lock selected tasks in stable ID order and roll back on any rejected item.
- Dependency creation takes a tenant-scoped advisory lock and checks the graph for cycles before inserting the relationship.
- The outbox poller locks only unpublished rows using `SKIP LOCKED`, publishes to Kafka with receipts enabled, then records publication. A crash after Kafka acknowledgment can result in a replay.
- BullMQ retries failures with exponential backoff. Invalid event envelopes and exhausted jobs go to the dead-letter topic. A durable execution starts as Queued and becomes Succeeded after the worker acknowledges delivery.
- Subscription state and source event IDs update in one locked transaction. Test checkout uses a bounded idempotency window and the billing portal handles plan changes for existing Stripe customers.
- File metadata is tenant-scoped. Object keys contain organization, task and attachment IDs. The upload path enforces a 5 MB limit, extension/content consistency and a safe basename. Downloads are forced attachments. If metadata insertion fails, the controller attempts object removal. A crash between the object and database writes can leave an orphan.

## Observability and investigation

Start at ingress. Record the response's `X-Correlation-ID`, inspect the Java outbox and the Node worker log for that ID, then check processing state across the outbox, job queue, and workflow execution. The worker logs event type, event ID, and correlation ID. The gateway and core expose Prometheus metrics for traffic and readiness. NestJS exposes database-backed readiness at `/ready` inside the service network.

```bash
docker compose ps
docker compose logs --since 10m gateway core realtime
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group nexusflow-workflows-v1
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic nexusflow.domain.dlq.v1 --from-beginning --max-messages 10
```

Review dead-letter records before replaying. Retried events use the original ID to preserve notification deduplication.
