# Local performance measurements

## Mixed workload and worker recovery

On 25 November 2026 the patched release ran behind native Nginx with Redis rate limiting enabled. Twelve authenticated users maintained WebSocket connections across three workspaces. The test ran for six minutes, including a five-minute plateau. It issued 2,106 timed API requests at 5.85 requests per second overall and 6.32 per second at the plateau, with zero failed requests and an overall p95 of 52.93 ms.

| Timed operation | Requests | p95 |
| --- | ---: | ---: |
| Board snapshot | 630 | 31.23 ms |
| Task details | 212 | 40.21 ms |
| Message history | 211 | 45.85 ms |
| Task edit | 421 | 53.26 ms |
| Notifications | 211 | 42.43 ms |
| Message send | 211 | 61.91 ms |
| Channel list | 210 | 42.54 ms |

Reconciliation confirmed 421 persisted task edits, 211 persisted messages, all 844 expected socket deliveries, and 214 completed workflow runs. A separate drill stopped the realtime worker, accepted three task writes during the interruption, then verified one completed run and one durable notification per task. Verification completed 26.99 seconds after the restart request.

In a subsequent HTTPS run, the single Kafka broker was stopped while the API accepted three writes. The records remained readable during the interruption, and all three workflows and notifications were reconciled after restart. The workflows completed 26.21 seconds after the restart request. During a separate Redis interruption, the gateway returned HTTP 503 for an authenticated request. The same session returned HTTP 200 within 0.85 seconds after the restart request. These are restart drills on one host.

The final HTTPS soak used 12 authenticated users and live WebSockets across three workspaces for 13 minutes, including a 12-minute plateau. It recorded 2,172 timed requests, zero failures, a 39.87 ms overall p95 and approximately 2.88 requests per second at the plateau. Reconciliation matched 434 edits, 217 messages, 868 socket deliveries and 220 workflow executions. Request pacing kept the run within the API's bounded history windows. Use `NEXUS_PLATEAU_SECONDS=720` to select this profile.

The traffic is paced beneath one ingress client's rate limit. These measurements apply to the tested local workload. Production capacity, multi-hour behavior and multi-host failover remain unmeasured.

Set `NEXUS_TEST_URL` to the exact `NEXUS_ORIGIN` of a disposable local installation with email verification disabled.

```sh
export NEXUS_DISPOSABLE=1 NEXUS_TEST_URL=http://localhost:3000
node tests/load/mixed.mjs
node tests/load/worker-recovery.mjs --compose
node tests/load/broker-recovery.mjs --compose
node tests/load/rate-limit-recovery.mjs --compose
```

[Mixed workload results](benchmarks/mixed.json) · [HTTPS soak results](benchmarks/soak.json) · [Worker recovery results](benchmarks/worker-recovery.json) · [Kafka restart results](benchmarks/broker-recovery.json) · [Redis restart results](benchmarks/rate-limit-recovery.json)

## Initial API and WebSocket microbenchmarks

Measured on 24 November 2026 using k6 1.5.0 on the Windows host against Next.js, the Spring Cloud Gateway, Spring Boot core, NestJS and PostgreSQL 17.12. Both runs used eight concurrent virtual users and a ten-second load period. The API run used the seeded Orbit Labs workspace with 12 projects and 96 tasks.

| Scenario | Concurrency | Samples | Average | P95 | Throughput | Error rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Workspace snapshot | 8 virtual users | 2,845 snapshots | 27.92 ms | 58.55 ms | 270.77 snapshots/s | 0% |
| Socket.IO WebSocket upgrade | 8 virtual users | 24 connections | 18.66 ms | 24.50 ms | 2.18 connections/s | 0% |

The snapshot duration is the k6 aggregate including the two setup requests. Throughput and error rate for the snapshot come from the scenario checks. All 24 WebSocket upgrades and authenticated workspace room joins succeeded. The socket throughput reflects the script's 3.5-second connection hold time. It measures successful upgrades per second under that test shape.

The runs used one machine and disabled Redis rate limiting so the repeated loopback requests could reach the API. No server-side report cache was exercised, so cache hit rate is not applicable. These numbers describe this local run.

## Reproduce

Set `NEXUS_EMAIL` and `NEXUS_PASSWORD` for a disposable demo account and set `NEXUS_URL` to the target origin. Scope load tests to an instance you control. For the local unlimited scenario, set `NEXUS_RATE_LIMIT=false` on the gateway before startup.

```bash
VUS=8 DURATION=10s k6 run --no-usage-report tests/load/api.js
VUS=8 DURATION=10s k6 run --no-usage-report tests/load/socket.js
```

[Raw k6 snapshot result](benchmarks/api.json) · [Raw WebSocket result](benchmarks/socket.json)
