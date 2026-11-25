import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { Pool } from "pg";
import { config } from "./config.js";

@Injectable()
export class Store implements OnModuleInit, OnApplicationShutdown {
  readonly pool = new Pool({
    connectionString: config.database,
    max: 12,
    connectionTimeoutMillis: 4000,
  });

  async onModuleInit() {
    const database = await this.pool.connect();
    try {
      await database.query("BEGIN");
      await database.query("SELECT pg_advisory_xact_lock(662110)");
      await database.query(`
        CREATE TABLE IF NOT EXISTS channels (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id uuid NOT NULL,
          name varchar(40) NOT NULL,
          UNIQUE(org_id, id), UNIQUE(org_id, name)
        );
        CREATE TABLE IF NOT EXISTS messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id uuid NOT NULL,
          channel_id uuid NOT NULL,
          author_id uuid NOT NULL,
          author varchar(100) NOT NULL,
          body varchar(4000) NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          FOREIGN KEY(org_id, channel_id) REFERENCES channels(org_id, id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages(org_id, channel_id, created_at DESC, id);
        CREATE TABLE IF NOT EXISTS notifications (
          id uuid PRIMARY KEY,
          org_id uuid NOT NULL,
          user_id uuid NOT NULL,
          title varchar(500) NOT NULL,
          read boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(org_id, user_id, created_at DESC);
        ALTER TABLE notifications ADD COLUMN IF NOT EXISTS href text;
        CREATE TABLE IF NOT EXISTS notification_preferences (
          org_id uuid NOT NULL,user_id uuid NOT NULL,email boolean NOT NULL DEFAULT false,
          PRIMARY KEY(org_id,user_id)
        );
        ALTER TABLE channels ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'channel';
        ALTER TABLE channels ADD COLUMN IF NOT EXISTS project_id uuid;
        ALTER TABLE channels ADD COLUMN IF NOT EXISTS conversation_key text;
        ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_org_id_name_key;
        CREATE UNIQUE INDEX IF NOT EXISTS public_channel_names ON channels(org_id,name) WHERE kind IN ('channel','project');
        CREATE UNIQUE INDEX IF NOT EXISTS conversation_keys ON channels(org_id,conversation_key) WHERE conversation_key IS NOT NULL;
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;
        CREATE TABLE IF NOT EXISTS conversation_members (
          org_id uuid NOT NULL, channel_id uuid NOT NULL, user_id uuid NOT NULL,
          PRIMARY KEY(org_id,channel_id,user_id),
          FOREIGN KEY(org_id,channel_id) REFERENCES channels(org_id,id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS conversation_reads (
          org_id uuid NOT NULL, channel_id uuid NOT NULL, user_id uuid NOT NULL, read_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(org_id,channel_id,user_id),
          FOREIGN KEY(org_id,channel_id) REFERENCES channels(org_id,id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS messages_org_channel_id ON messages(org_id,channel_id,id);
        CREATE TABLE IF NOT EXISTS message_reactions (
          org_id uuid NOT NULL, channel_id uuid NOT NULL, message_id uuid NOT NULL, user_id uuid NOT NULL, emoji text NOT NULL,
          PRIMARY KEY(org_id,channel_id,message_id,user_id,emoji),
          FOREIGN KEY(org_id,channel_id,message_id) REFERENCES messages(org_id,channel_id,id) ON DELETE CASCADE
        );
      `);
      if (config.demo) await this.seed(database);
      await database.query("COMMIT");
    } catch (error) {
      await database.query("ROLLBACK");
      throw error;
    } finally {
      database.release();
    }
  }

  private async seed(db: import("pg").PoolClient) {
    const org = "00000000-0000-4000-8000-000000000001";
    const channel = "00000000-0000-4000-8000-000000000701";
    await db.query(
      "INSERT INTO channels(id,org_id,name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [channel, org, "general"],
    );
    for (const name of ["engineering", "design", "launch-room"]) {
      await db.query(
        "INSERT INTO channels(org_id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [org, name],
      );
    }
    const messages = [
      [
        "102",
        "Maya Chen",
        "The onboarding flow is ready for a final pass. I’ve linked the accessibility checklist in the project.",
      ],
      [
        "103",
        "Jordan Lee",
        "Real-time updates are working in staging. I’m running the reconnect and multi-tab checks this afternoon.",
      ],
      [
        "105",
        "Priya Patel",
        "I’ve updated the reporting dashboard with the latest sample data.",
      ],
      [
        "101",
        "Alex Morgan",
        "Let’s keep release notes and follow-ups in #launch-room so everyone has the same context.",
      ],
    ];
    for (const [index, [user, author, body]] of messages.entries()) {
      await db.query(
        `INSERT INTO messages(id,org_id,channel_id,author_id,author,body,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,now()-($7*interval '1 minute')) ON CONFLICT DO NOTHING`,
        [
          "00000000-0000-4000-8000-00000000080" + (index + 1),
          org,
          channel,
          "00000000-0000-4000-8000-000000000" + user,
          author,
          body,
          390 - index * 30,
        ],
      );
    }
    await db.query(
      `INSERT INTO notifications(id,org_id,user_id,title)
      VALUES ('00000000-0000-4000-8000-000000001001',$1,'00000000-0000-4000-8000-000000000101','Workspace onboarding is due this week.')
      ON CONFLICT DO NOTHING`,
      [org],
    );
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
