# Deployment verification

The local release rehearsal used native Nginx, a standalone Next.js build, the Spring Cloud Gateway, the Spring Boot API, NestJS, PostgreSQL, Redis and Kafka. Each process listened on loopback. This let the test clients enter through the same Nginx routes configured for the application.

| Check | Evidence |
| --- | --- |
| Web runtime | The isolated traced server served the page and all 13 linked static assets. |
| Public ingress | The ingress smoke check exercised HTML, gateway readiness, authentication, correlation IDs, Socket.IO handshake, security headers and restrictions on internal routes. |
| Client identity | Nginx replaces the incoming client-IP header. The gateway accepts a single valid IP only in private-ingress mode. The gateway unit tests exercise direct, trusted and ambiguous identities. |
| AWS proxy configuration | Native Nginx checks exercised the ALB subnet trust rules, HTTPS response headers and omission of request query strings from access logs. |
| Infrastructure definitions | The local and AWS Compose configurations rendered. The AWS configuration checks and Terraform validation passed. All 11 public build and service image references resolved to Linux amd64 manifests and are pinned by digest. |
| Database recovery | A fresh second PostgreSQL instance restored both source snapshots and matched their public table fingerprints. [Rehearsal and commands](database-recovery.md) |
| Object storage | The previous MinIO reference refused anonymous registry pulls. The replacement SeaweedFS 4.55 passed a signed upload and byte-for-byte download through the patched core API. Anonymous storage access and cross-tenant attachment access returned HTTP 403. [SeaweedFS quick start](https://github.com/seaweedfs/seaweedfs/blob/master/README.md#quick-start) |
| Browser and API | Live Playwright registered a user, onboarded a workspace, created a project and checked persisted chat through the real ingress. The API suite also passed tenant and role restrictions, task concurrency and the Kafka notification path. |
| HTTPS and email | Native Nginx used a short-lived certificate trusted explicitly by the test client. The smoke check verified HSTS. The account test verified HTTPS email links, secure HttpOnly cookies, password reset, token replay rejection and session revocation against a loopback SMTP capture. |
| Broker and rate limiter recovery | During a Kafka stop, PostgreSQL retained three accepted writes. Restart produced three successful workflows and three unique notifications. During a Redis stop, the gateway returned HTTP 503 and recovered the same authenticated session after restart. [Recovery results](benchmarks.md) |
| Secure WebSocket | The HTTPS test found an upgrade rejection at the private HTTP gateway. The gateway now allows the exact public origin for WebSocket upgrades. The live HTTPS API suite and browser chat test passed after the change. The browser observed authenticated presence events over WSS. |
| Infrastructure security scan | Trivy reported zero high or critical findings for the restricted staging test profile and the four application Dockerfiles. The AWS template uses a dedicated KMS key for new attachments and restricts database and SMTP egress. The public defaults still trigger checks for the internet-facing ALB and outbound HTTPS to any address. The restricted scan uses example network ranges and verifies configuration only. [AWS deployment](aws.md) |

GitHub Actions ran the complete Compose stack on Linux, including the live API and browser flows, and confirmed Grafana readiness and Prometheus scrapes. The CI run also checks the four application images for dependency advisories. AWS deployment, load-balancer certificate validation and multi-host failover remain open. The current infrastructure has one application host, one Kafka broker and one Redis instance. [GitHub Actions runs](https://github.com/ankush-48/NexusFlow/actions)

## Repeat the public smoke check

Run the following from the repository root after the stack is ready. The script checks the actual response statuses, response headers and the Engine.IO opening packet.

```sh
node scripts/smoke-ingress.mjs http://localhost:3000
```

The Linux CI workflow also builds each application image and checks Grafana, Prometheus scrape health and image vulnerabilities. Its manual run adds a paced workload and worker, Kafka and Redis interruption drills. The AWS runbook covers immutable image tags, secure configuration and rollback. [Workflow](../.github/workflows/checks.yml) · [AWS deployment](aws.md)
