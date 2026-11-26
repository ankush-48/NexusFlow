FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/
COPY services/realtime-service/package.json services/realtime-service/
RUN npm ci --workspace @nexusflow/realtime --include-workspace-root
COPY services/realtime-service services/realtime-service
RUN npm run build --workspace @nexusflow/realtime && npm prune --omit=dev --workspace @nexusflow/realtime && mkdir -p services/realtime-service/node_modules

FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
# The package manager is needed only in the build stage.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/realtime-service/package.json ./services/realtime-service/package.json
COPY --from=build --chown=node:node /app/services/realtime-service/dist ./services/realtime-service/dist
COPY --from=build --chown=node:node /app/services/realtime-service/node_modules ./services/realtime-service/node_modules
USER node
EXPOSE 4000
CMD ["node","services/realtime-service/dist/main.js"]
