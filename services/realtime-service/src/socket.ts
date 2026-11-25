import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { Server, Socket } from "socket.io";
import { Access, uuid, verifyOrigin } from "./access.js";
import { config } from "./config.js";
import { Conversations } from "./conversations.js";
import { z } from "zod";

@Injectable()
export class Live implements OnApplicationShutdown {
  private io?: Server;
  private redis?: Redis;
  private subscriber?: Redis;
  private readonly presenceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly access: Access,
    private readonly conversations: Conversations,
  ) {}

  async attach(httpServer: import("node:http").Server) {
    const io = new Server(httpServer, {
      maxHttpBufferSize: 16384,
      allowRequest: (request, accept) => {
        try {
          verifyOrigin(
            request.headers.origin,
            request.headers["sec-fetch-site"] as string | undefined,
          );
          accept(null, true);
        } catch {
          accept("Origin denied", false);
        }
      },
    });
    this.io = io;
    if (config.redis) {
      this.redis = new Redis(config.redis, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      this.subscriber = this.redis.duplicate({ lazyConnect: true });
      await Promise.all([this.redis.connect(), this.subscriber.connect()]);
      io.adapter(createAdapter(this.redis, this.subscriber));
    }
    io.on("presence.members", (org: string, respond: (users: string[]) => void) => {
      respond(this.localMembers(org));
    });
    io.use(async (socket, next) => {
      try {
        await this.access.account(socket.request.headers.cookie);
        next();
      } catch {
        next(new Error("Sign in to continue."));
      }
    });
    io.on("connection", (socket) => {
      // A channel and workspace subscription can arrive in the same browser tick.
      // Keep their authorization and adapter changes in order, with bounded pending work.
      let tail = Promise.resolve();
      let pending = 0;
      const subscribe = (ack: (result: { ok: boolean }) => void, change: () => Promise<void>) => {
        if (pending >= 4) return ack({ ok: false });
        pending++;
        tail = tail.then(async () => {
          try {
            if (!socket.connected) return;
            await change();
            ack({ ok: true });
          } catch {
            ack({ ok: false });
          } finally {
            pending--;
          }
        });
      };
      socket.on(
        "channel.join",
        (input: unknown, ack?: (result: { ok: boolean }) => void) => {
          if (typeof ack !== "function") return;
          const data = z
            .object({ orgId: uuid, channelId: uuid })
            .safeParse(input);
          if (!data.success) return ack({ ok: false });
          const { orgId, channelId } = data.data;
          subscribe(ack, async () => {
            if (socket.data.workspace && socket.data.workspace.org !== orgId)
              throw new Error("Workspace mismatch");
            const member = await this.access.member(
              orgId,
              socket.request.headers.cookie,
            );
            await this.conversations.require(orgId, channelId, member);
            await this.join(socket, "channel", orgId, channelId);
            socket.data.channel = { orgId, channelId };
          });
        },
      );
      socket.on("channel.typing", async () => {
        const channel = socket.data.channel;
        if (
          !channel ||
          Date.now() - (socket.data.lastTyping ?? 0) < 1500
        )
          return;
        socket.data.lastTyping = Date.now();
        try {
          const member = await this.access.member(channel.orgId, socket.request.headers.cookie);
          this.access.canWrite(member);
          await this.conversations.require(channel.orgId, channel.channelId, member);
          if (socket.connected && socket.data.channel === channel)
            socket.to("channel:" + channel.orgId + ":" + channel.channelId)
              .emit("channel.typing", member.name);
        } catch {
          // A role or membership may have changed while the conversation was open.
        }
      });
      socket.on(
        "workspace.join",
        (input: unknown, ack?: (result: { ok: boolean }) => void) => {
          if (typeof ack !== "function") return;
          const org = uuid.safeParse(input);
          if (!org.success) return ack({ ok: false });
          subscribe(ack, async () => {
            const member = await this.access.member(
              org.data,
              socket.request.headers.cookie,
            );
            const previous = socket.data.workspace?.org as string | undefined;
            const channel = socket.data.channel;
            if (channel && channel.orgId !== org.data) {
              delete socket.data.channel;
              await socket.leave("channel:" + channel.orgId + ":" + channel.channelId);
            }
            await this.join(socket, "workspace", org.data);
            await this.join(socket, "user", org.data, member.id);
            socket.data.workspace = { org: org.data, memberId: member.id };
            this.schedulePresence(org.data);
            if (previous && previous !== org.data) this.schedulePresence(previous);
          });
        },
      );
      let checking = false;
      const timer = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          await this.refreshSession(socket);
        } catch {
          socket.disconnect(true);
        } finally {
          checking = false;
        }
      }, 15000).unref();
      socket.on("disconnect", () => {
        clearInterval(timer);
        const org = socket.data.workspace?.org;
        if (org) this.schedulePresence(org);
      });
    });
  }

  private schedulePresence(org: string) {
    if (this.presenceTimers.has(org)) return;
    this.presenceTimers.set(org, setTimeout(() => {
      this.presenceTimers.delete(org);
      void this.presence(org);
    }, 100).unref());
  }

  private localMembers(org: string): string[] {
    const ns = this.io?.sockets;
    if (!ns) return [];
    const members = new Set<string>();
    for (const id of ns.adapter.rooms.get("workspace:" + org) ?? []) {
      const member = ns.sockets.get(id)?.data.workspace;
      if (member?.org === org) members.add(member.memberId);
    }
    return [...members];
  }

  private async presence(org: string) {
    if (!this.io) return;
    const room = "workspace:" + org;
    try {
      const remote: string[][] = this.redis
        ? await this.io.serverSideEmitWithAck("presence.members", org)
        : [];
      const online = [...new Set([...this.localMembers(org), ...remote.flat()])];
      this.io.to(room).emit("workspace.presence", { online });
    } catch {
      // Presence updates resume when the Redis adapter is reachable again.
    }
  }

  private async join(socket: Socket, kind: string, org: string, id?: string) {
    await Promise.all(
      [...socket.rooms]
        .filter((room) => room.startsWith(kind + ":"))
        .map((room) => socket.leave(room)),
    );
    if (!socket.connected) throw new Error("Connection closed");
    await socket.join([kind, org, id].filter(Boolean).join(":"));
  }

  private async refreshSession(socket: Socket) {
    const cookie = socket.request.headers.cookie;
    const channel = socket.data.channel;
    const org = socket.data.workspace?.org ?? channel?.orgId;
    if (!org) {
      await this.access.account(cookie);
      return;
    }
    const member = await this.access.member(org, cookie);
    if (channel) await this.conversations.require(channel.orgId, channel.channelId, member);
  }

  message(org: string, channel: string) {
    this.io?.to("channel:" + org + ":" + channel).emit("message.created");
  }
  task(org: string) {
    this.io?.to("workspace:" + org).emit("task.changed");
  }
  notification(org: string, user: string) {
    this.io?.to("user:" + org + ":" + user).emit("notification.created");
  }

  async onApplicationShutdown() {
    await this.io?.close();
    for (const timer of this.presenceTimers.values()) clearTimeout(timer);
    this.presenceTimers.clear();
    this.redis?.disconnect();
    this.subscriber?.disconnect();
  }
}
