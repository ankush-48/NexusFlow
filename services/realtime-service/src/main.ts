import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Access, verifyOrigin } from "./access.js";
import { config } from "./config.js";
import { Conversations } from "./conversations.js";
import { CollaborationController } from "./controller.js";
import { Jobs } from "./jobs.js";
import { Live } from "./socket.js";
import { Store } from "./store.js";

@Module({
  controllers: [CollaborationController],
  providers: [Access, Store, Conversations, Live, Jobs],
})
class AppModule {}

async function bootstrap() {
  if (!config.database) throw new Error("REALTIME_DB_URL is required.");
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.use(
    (request: IncomingMessage, response: ServerResponse, next: () => void) => {
      try {
        verifyOrigin(
          request.headers.origin,
          request.headers["sec-fetch-site"] as string | undefined,
        );
        next();
      } catch {
        response
          .writeHead(403, { "content-type": "application/problem+json" })
          .end(
            JSON.stringify({
              status: 403,
              detail: "Request origin is not allowed.",
            }),
          );
      }
    },
  );
  await app.init();
  await app.get(Live).attach(app.getHttpServer());
  await app.get(Jobs).connect();
  await app.listen(config.port, "0.0.0.0");
}

void bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
