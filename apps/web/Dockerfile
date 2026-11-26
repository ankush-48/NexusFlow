FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/
COPY services/realtime-service/package.json services/realtime-service/
RUN npm ci --workspace @nexusflow/web --include-workspace-root
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1 NEXUS_STANDALONE=1
ARG GATEWAY_URL=http://gateway:8080
ENV GATEWAY_URL=$GATEWAY_URL
RUN mkdir -p apps/web/public && npm run build --workspace @nexusflow/web

FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
# The package manager is needed only in the build stage.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node","apps/web/server.js"]
