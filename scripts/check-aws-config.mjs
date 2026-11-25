// Read the rendered Compose model via stdin so service credentials stay off disk.
import { readFileSync } from "node:fs";

let services;
try {
  ({ services } = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, "")));
} catch {
  throw new Error("Expected the rendered Compose JSON model on standard input.");
}
function requireSetting(ok, message) {
  if (!ok) throw new Error(message);
}
function parseUrl(value, name) {
  try { return new URL(value); }
  catch { throw new Error(name + " must be a valid URL."); }
}
const core = services.core.environment;
const realtime = services.realtime.environment;
const gateway = services.gateway.environment;
const origin = parseUrl(core.NEXUS_ORIGIN, "NEXUS_ORIGIN");
requireSetting(origin.protocol === "https:" && origin.origin === core.NEXUS_ORIGIN,
  "NEXUS_ORIGIN must be a canonical HTTPS origin without a path.");
requireSetting([realtime, gateway].every(service => service.NEXUS_ORIGIN === origin.origin),
  "Browser origin must match across the three backend services.");
requireSetting(core.NEXUS_SECURE_COOKIES === "true" && core.NEXUS_VERIFY_EMAIL === "true",
  "Secure cookies and email verification must be enabled.");
requireSetting(!core.NEXUS_DEMO_PASSWORD && realtime.NEXUS_SEED_COLLAB === "false",
  "Demo fixtures must be disabled.");
requireSetting(core.NEXUS_WORKER_SECRET?.length >= 32 && realtime.NEXUS_WORKER_SECRET === core.NEXUS_WORKER_SECRET,
  "Use a shared, random worker secret of at least 32 characters.");
requireSetting(!core.NEXUS_S3_ENDPOINT && !core.NEXUS_S3_ACCESS_KEY && !core.NEXUS_S3_SECRET_KEY && core.NEXUS_S3_BUCKET,
  "S3 must use the provisioned bucket and instance credentials.");
requireSetting(core.SPRING_MAIL_PROPERTIES_MAIL_SMTP_STARTTLS_REQUIRED === "true" &&
  core.SPRING_MAIL_PROPERTIES_MAIL_SMTP_SSL_CHECKSERVERIDENTITY === "true",
  "SMTP requires TLS and server identity checks.");
for (const [name, connection] of [["core", core.CORE_DB_URL.replace(/^jdbc:/, "")], ["realtime", realtime.REALTIME_DB_URL]]) {
  const db = parseUrl(connection, name + " database connection");
  const ca = "/etc/rds/global-bundle.pem";
  requireSetting(db.searchParams.get("sslmode") === "verify-full" && db.searchParams.get("sslrootcert") === ca &&
    services[name].volumes?.some(volume => volume.target === ca && volume.read_only),
    name + " requires a verified TLS connection to RDS and a read-only CA mount.");
}
for (const name of ["postgres", "object-store", "mail"]) {
  requireSetting(!services[name], "Run with development fixture profiles disabled.");
}
for (const [name, service] of Object.entries(services)) {
  if (name === "nginx") continue;
  requireSetting(!(service.ports ?? []).some(port => !["127.0.0.1", "::1"].includes(port.host_ip)),
    "Only ingress may publish a public port. Review " + name + ".");
}
requireSetting(gateway.NEXUS_TRUST_INGRESS_IP === "true" && !services.gateway.ports?.length,
  "The gateway must consume the ingress client identity on its private interface.");
for (const name of ["web", "nginx"]) {
  requireSetting(Object.keys(services[name].networks).length === 1 && services[name].networks.ingress !== undefined,
    name + " must use the ingress network only.");
}
requireSetting(services.nginx.volumes.some(volume => volume.target === "/etc/nginx/conf.d/00-ingress.conf" &&
  /[/\\]ingress-aws\.conf$/.test(volume.source) && volume.read_only), "Mount the AWS ingress configuration.");
requireSetting(services.nginx.ports.length === 1 && services.nginx.ports[0].published === "3000" &&
  services.nginx.ports[0].target === 80, "Ingress must match the ALB target group.");
console.log("PASS production Compose settings for ingress, identities, storage, transport and development fixtures.");
