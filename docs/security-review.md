# Application security review

## Findings addressed

| Area | Change | Verification |
| --- | --- | --- |
| Java runtime dependencies | Upgraded both services to Spring Boot 4.2.0, migrated the gateway to the compatible Spring Cloud release, updated Jackson usage, and pinned Kafka compression codecs. | Both Maven builds passed. OSV returned matches for 16 package versions in the original runtime trees. A fresh query on 25 November 2026 returned zero matches across 208 distinct package versions in the updated trees. |
| Expiring and revoked sessions | Access-token validity is bounded by the original refresh expiry. A password change and an in-flight login serialize on the account record. Logout can invalidate a session using the remaining refresh cookie. | The PostgreSQL regression suite exercises the login/reset race and the absolute expiration boundary. The API integration suite exercises refresh-only logout, replay rejection and normal login. |
| Realtime authorization | Workspace and channel joins serialize per connection. Changing workspaces clears the previous channel. Typing requires current write access. The service forwards only the access cookie to the identity service. | Socket subscription tests cover room changes and failures. A connected socket rechecks membership and channel access every 15 seconds. The browser reauthorizes before reconnecting. |
| Reverse-proxy trust | Nginx overwrites forwarding headers. Only private-ingress mode accepts its client address. Direct installations use the TCP peer. Access logs omit query strings that can carry invitation or verification tokens. | Gateway unit tests and native Nginx checks exercise the trust boundary. The public smoke test checks private paths, cache controls, request IDs and browser security headers. |

The npm production audit returned zero known vulnerabilities during this review. The checks cover the application dependency sets defined by the current lockfile and Maven runtime graphs. The container base images have a separate CI scan. This was a source review with functional regression tests. Independent penetration testing, an external compliance audit and production-network validation remain open.

## Repeat the Java dependency check

Run the following from the repository root. The audit script sends public package coordinates and resolved versions to OSV. A match or an incomplete scan returns a nonzero exit status. [OSV batch API](https://google.github.io/osv.dev/post-v1-querybatch/)

```sh
mvn -f services/core-api/pom.xml org.apache.maven.plugins:maven-dependency-plugin:3.7.0:tree -Dscope=runtime -DoutputType=json -DoutputFile=target/runtime-deps.json
mvn -f services/api-gateway/pom.xml org.apache.maven.plugins:maven-dependency-plugin:3.7.0:tree -Dscope=runtime -DoutputType=json -DoutputFile=target/runtime-deps.json
node scripts/audit-java.mjs services/core-api/target/runtime-deps.json services/api-gateway/target/runtime-deps.json
npm audit --omit=dev --audit-level=high
```

Recheck these results at release time. The advisory databases and the underlying container images change independently of this source bundle.
