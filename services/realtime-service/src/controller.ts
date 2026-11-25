import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import { Access, uuid, validate } from "./access.js";
import { Conversations } from "./conversations.js";
import { Live } from "./socket.js";
import { Store } from "./store.js";

@Controller()
export class CollaborationController {
  constructor(
    private readonly access: Access,
    private readonly store: Store,
    private readonly live: Live,
    private readonly conversations: Conversations,
  ) {}

  @Get("health")
  health() {
    return { status: "UP" };
  }

  @Get("ready")
  async ready() {
    await this.store.pool.query("SELECT 1");
    return { status: "UP" };
  }

  @Get("api/collab/:org/channels")
  async channels(
    @Param("org") org: string,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    await this.store.pool.query(
      "INSERT INTO channels(org_id,name) VALUES ($1,'general') ON CONFLICT DO NOTHING",
      [org],
    );
    const result = await this.store.pool.query(
      `
      SELECT c.id,c.name,c.kind,(SELECT count(*)::int FROM messages m WHERE m.org_id=$1 AND m.channel_id=c.id AND m.author_id<>$2 AND
        m.created_at>coalesce((SELECT read_at FROM conversation_reads r WHERE r.org_id=$1 AND r.channel_id=c.id AND r.user_id=$2),'-infinity')) AS unread
      FROM channels c WHERE c.org_id=$1 AND (c.kind IN ('channel','project') OR EXISTS (
        SELECT 1 FROM conversation_members m WHERE m.org_id=$1 AND m.channel_id=c.id AND m.user_id=$2))
      ORDER BY (c.name='general') DESC,c.kind,c.name LIMIT 100
    `,
      [org, member.id],
    );
    return result.rows;
  }

  @Post("api/collab/:org/channels")
  async createChannel(
    @Param("org") org: string,
    @Body() body: unknown,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    const data = validate(
      z.object({
        name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
        kind: z
          .enum(["channel", "project", "direct", "group"])
          .default("channel"),
        members: z.array(uuid).max(20).default([]),
        projectId: uuid.optional(),
      }),
      body,
    );
    const result = await this.conversations.create(org, member, cookie, data);
    if (!result) throw new ConflictException("This channel already exists.");
    return result;
  }

  @Get("api/collab/:org/channels/:channel/messages")
  async messages(
    @Param("org") org: string,
    @Param("channel") channel: string,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    await this.conversations.require(org, channel, member);
    const result = await this.store.pool.query(
      `
      SELECT m.id,m.author,m.author_id AS "authorId",m.body,m.created_at AS "createdAt",m.edited_at AS "editedAt",
        (SELECT count(*)::int FROM conversation_reads r WHERE r.org_id=$1 AND r.channel_id=$2 AND r.user_id<>m.author_id AND r.read_at>=m.created_at) AS "readCount",
        coalesce((SELECT json_agg(reaction) FROM (
          SELECT emoji,count(*)::int AS count,bool_or(user_id=$3) AS mine FROM message_reactions
          WHERE org_id=$1 AND channel_id=$2 AND message_id=m.id GROUP BY emoji) reaction),'[]'::json) AS reactions
      FROM (SELECT * FROM messages WHERE org_id=$1 AND channel_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100) m
      ORDER BY m.created_at,m.id
    `,
      [org, channel, member.id],
    );
    return result.rows;
  }

  @Post("api/collab/:org/channels/:channel/messages")
  async send(
    @Param("org") org: string,
    @Param("channel") channel: string,
    @Body() input: unknown,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    this.access.canWrite(member);
    await this.conversations.require(org, channel, member);
    const { body } = validate(
      z.object({ body: z.string().trim().min(1).max(4000) }),
      input,
    );
    const result = await this.store.pool.query(
      `
      INSERT INTO messages(org_id,channel_id,author_id,author,body) VALUES ($1,$2,$3,$4,$5)
      RETURNING id, author,author_id AS "authorId", body, created_at AS "createdAt"
    `,
      [org, channel, member.id, member.name, body],
    );
    this.live.message(org, channel);
    return result.rows[0];
  }

  @Get("api/collab/:org/search")
  async search(
    @Param("org") org: string,
    @Query("q") term: unknown,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    const query = validate(z.string().trim().min(2).max(100), term);
    const result = await this.store.pool.query(
      `
      SELECT m.id,c.id AS "channelId",c.name AS channel,m.author,m.body FROM messages m
      JOIN channels c ON c.id=m.channel_id AND c.org_id=m.org_id
      WHERE m.org_id=$1 AND strpos(lower(m.body || ' ' || m.author),lower($2))>0 AND
        (c.kind IN ('channel','project') OR EXISTS(SELECT 1 FROM conversation_members cm WHERE cm.org_id=$1 AND cm.channel_id=c.id AND cm.user_id=$3))
      ORDER BY m.created_at DESC LIMIT 10
    `,
      [org, query, member.id],
    );
    return result.rows;
  }

  @Get("api/collab/:org/notifications")
  async notifications(
    @Param("org") org: string,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    const result = await this.store.pool.query(
      `
      SELECT id,title,read,href,created_at AS "createdAt" FROM notifications WHERE org_id=$1 AND user_id=$2
      ORDER BY created_at DESC LIMIT 100
    `,
      [org, member.id],
    );
    return result.rows;
  }

  @Get("api/collab/:org/notification-preferences")
  async preferences(
    @Param("org") org: string,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    const result = await this.store.pool.query(
      "SELECT email FROM notification_preferences WHERE org_id=$1 AND user_id=$2",
      [org, member.id],
    );
    return { email: Boolean(result.rows[0]?.email) };
  }

  @Patch("api/collab/:org/notification-preferences")
  async changePreferences(
    @Param("org") org: string,
    @Body() input: unknown,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    const { email } = validate(z.object({ email: z.boolean() }), input);
    await this.store.pool.query(
      `
      INSERT INTO notification_preferences(org_id,user_id,email) VALUES ($1,$2,$3)
      ON CONFLICT(org_id,user_id) DO UPDATE SET email=EXCLUDED.email
    `,
      [org, member.id, email],
    );
    return { email };
  }

  @Patch("api/collab/:org/notifications")
  async readAll(@Param("org") org: string, @Headers("cookie") cookie?: string) {
    const member = await this.access.member(org, cookie);
    await this.store.pool.query(
      "UPDATE notifications SET read=true WHERE org_id=$1 AND user_id=$2 AND NOT read",
      [org, member.id],
    );
    return { read: true };
  }

  @Patch("api/collab/:org/notifications/:id")
  async readOne(
    @Param("org") org: string,
    @Param("id") id: string,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    validate(uuid, id);
    await this.store.pool.query(
      "UPDATE notifications SET read=true WHERE org_id=$1 AND user_id=$2 AND id=$3",
      [org, member.id, id],
    );
    return { read: true };
  }

  @Patch("api/collab/:org/channels/:channel/read")
  async read(
    @Param("org") org: string,
    @Param("channel") channel: string,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    await this.conversations.require(org, channel, member);
    await this.store.pool.query(
      `
      INSERT INTO conversation_reads(org_id,channel_id,user_id) VALUES ($1,$2,$3)
      ON CONFLICT(org_id,channel_id,user_id) DO UPDATE SET read_at=now()
    `,
      [org, channel, member.id],
    );
    return { read: true };
  }

  @Patch("api/collab/:org/channels/:channel/messages/:id")
  async edit(
    @Param("org") org: string,
    @Param("channel") channel: string,
    @Param("id") id: string,
    @Body() input: unknown,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    this.access.canWrite(member);
    await this.conversations.require(org, channel, member);
    validate(uuid, id);
    const { body } = validate(
      z.object({ body: z.string().trim().min(1).max(4000) }),
      input,
    );
    const result = await this.store.pool.query(
      "UPDATE messages SET body=$1,edited_at=now() WHERE org_id=$2 AND channel_id=$3 AND id=$4 AND author_id=$5",
      [body, org, channel, id, member.id],
    );
    if (!result.rowCount)
      throw new NotFoundException("Message could not be found.");
    this.live.message(org, channel);
    return { id };
  }

  @Delete("api/collab/:org/channels/:channel/messages/:id")
  async delete(
    @Param("org") org: string,
    @Param("channel") channel: string,
    @Param("id") id: string,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    this.access.canWrite(member);
    await this.conversations.require(org, channel, member);
    validate(uuid, id);
    const result = await this.store.pool.query(
      "DELETE FROM messages WHERE org_id=$1 AND channel_id=$2 AND id=$3 AND author_id=$4",
      [org, channel, id, member.id],
    );
    if (!result.rowCount)
      throw new NotFoundException("Message could not be found.");
    this.live.message(org, channel);
    return { id };
  }

  @Patch("api/collab/:org/channels/:channel/messages/:id/reaction")
  async reaction(
    @Param("org") org: string,
    @Param("channel") channel: string,
    @Param("id") id: string,
    @Body() input: unknown,
    @Headers("cookie") cookie?: string,
  ) {
    const member = await this.access.member(org, cookie);
    this.access.canWrite(member);
    await this.conversations.require(org, channel, member);
    validate(uuid, id);
    const { emoji, active } = validate(
      z.object({ emoji: z.enum(["👍", "❤️", "🎉"]), active: z.boolean() }),
      input,
    );
    if (active) {
      await this.store.pool.query(
        `
        INSERT INTO message_reactions(org_id,channel_id,message_id,user_id,emoji)
        SELECT $1,$2,$3,$4,$5 FROM messages WHERE org_id=$1 AND channel_id=$2 AND id=$3 ON CONFLICT DO NOTHING
      `,
        [org, channel, id, member.id, emoji],
      );
    } else {
      await this.store.pool.query(
        "DELETE FROM message_reactions WHERE org_id=$1 AND channel_id=$2 AND message_id=$3 AND user_id=$4 AND emoji=$5",
        [org, channel, id, member.id, emoji],
      );
    }
    this.live.message(org, channel);
    return { active };
  }
}
