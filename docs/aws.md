# AWS deployment runbook

The configuration targets a single EC2 installation behind an HTTPS Application Load Balancer. It uses private Multi-AZ RDS for both databases and versioned S3 for task attachments. Kafka and Redis run on the application host. Review the instance, database standby and network charges before provisioning.

## Provision infrastructure

For a private staging environment, set `internal_alb=true` and restrict `ingress_ipv4_cidr` to the test network. The staging clients need a route into the VPC. For internet-facing staging with restricted access, set `ingress_ipv4_cidr` to the organization's public egress range. The public application profile leaves the load balancer internet-facing.

Set `smtp_ipv4_cidrs` to the selected provider's published ranges and keep Terraform's `smtp_port` aligned with Compose's `SMTP_PORT`. PostgreSQL egress is scoped to the database security group on port 5432. The default allows outbound HTTPS for AWS APIs, package repositories and container images. Set `https_egress_ipv4_cidrs` to approved destination ranges when those services are reachable at stable addresses through your network. The attachment bucket uses a dedicated AWS KMS key with rotation, and the application role can use it only through S3 for the attachment bucket.

1. Create an ACM certificate for the intended hostname in the selected region and validate it through DNS.
2. Set `region`, `certificate_arn`, and a globally unique `bucket_name` in a Terraform variables file. Use a remote encrypted state backend and limit write access to your deployment identities.
3. Run the following commands from `infrastructure/terraform`. Apply the plan only after reviewing the costs and resource changes.

```bash
terraform init
terraform validate
terraform plan -out=nexusflow.tfplan
terraform apply nexusflow.tfplan
```

4. Point DNS at the `alb_dns` output and use AWS Systems Manager Session Manager to connect to the `instance_id`. The instance accepts no SSH ingress.
5. Install Node.js 24 and Docker Compose 2.39 or later on the release host. Transfer the source or clone your own repository into the instance. Restrict access to Docker and to the generated application environment file.

## Prepare managed services

1. Retrieve the RDS bootstrap credentials through Secrets Manager using an authorized operator identity. From the EC2 host, connect to RDS with TLS verification.
2. With the RDS bootstrap account, use `infrastructure/docker/01-databases.sh` as the SQL reference to create `nexusflow_core` and `nexusflow_realtime`, grant database ownership, and revoke public connect on the application databases. Use independent random passwords.
3. Download the RDS global CA bundle from the [Amazon RDS trust store](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) and place it at `infrastructure/terraform/certs/global-bundle.pem`. Set `RDS_ENDPOINT`, `NEXUS_S3_BUCKET`, and `AWS_REGION` from the provisioned resources. The EC2 instance role supplies scoped S3 credentials.
4. Configure authenticated SMTP with STARTTLS. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM`. Set `NEXUS_ORIGIN` to the HTTPS hostname.
5. Run `node scripts/init-env.mjs` without demo fixtures. Set the actual RDS service credentials, the HTTPS origin and the settings above in the generated file. The generator produces independent random service credentials. Use URL-safe passwords for the database roles, since the realtime connection embeds its password in a URL.

## Release and verify

Set `NEXUS_RELEASE_TAG` to an unused release identifier such as the full source commit. Keep the prior release's source directory, image tags and environment configuration available. Use the same Compose project name across releases to preserve the Kafka and Redis volumes. The preflight reads the rendered model through standard input because it contains service credentials.

```bash
export NEXUS_RELEASE_TAG="$(git rev-parse HEAD)"
export COMPOSE_FILE=docker-compose.yml:docker-compose.aws.yml
docker compose config --format json | node scripts/check-aws-config.mjs
docker compose build core gateway realtime web
docker compose up --no-build --wait nginx
node scripts/smoke-ingress.mjs "https://YOUR_NEXUSFLOW_HOSTNAME"
```

Starting the `nginx` target brings up its dependency graph. Only Nginx publishes the application port. The instance security group admits the ALB security group on port 3000. Nginx accepts the ALB's appended client address only from its two provisioned subnets and overwrites forwarding headers on every route. The gateway keys rate limits from that private ingress identity. Keep the Nginx trusted ranges aligned with any changes to the Terraform edge subnets. [ALB forwarding behavior](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html) · [Nginx address processing](https://nginx.org/en/docs/http/ngx_http_realip_module.html)

Release checks cover HTML, gateway readiness, private API session handling, realtime routing, response headers and private endpoint boundaries. Use staging accounts to verify email delivery, task writes, a second user's chat updates and worker notifications. Take a database recovery point before schema changes and rehearse its restore. The AWS profile uses authenticated SMTP, secure cookies and signed S3 access. Billing starts disabled.

## Roll back a release

For a schema-compatible rollback, return to the previous source directory and environment with its prior release tag. Run `docker compose config --images` and confirm those application image tags are present locally. Run the following from that directory with the previous tag exported.

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.aws.yml
docker compose config --format json | node scripts/check-aws-config.mjs
docker compose up --no-build --wait nginx
node scripts/smoke-ingress.mjs "https://YOUR_NEXUSFLOW_HOSTNAME"
```

Rolling back application images preserves database changes. A release with incompatible migrations needs a forward fix or a separately rehearsed database recovery and replay of later writes. The single application host, Kafka and Redis remain shared failure points. Hosted rollout, failover and recovery exercises remain open. [Deployment validation](deployment-validation.md)
