import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Access, type Member, uuid, validate } from "./access.js";
import { Store } from "./store.js";

@Injectable()
export class Conversations {
  constructor(
    private readonly access: Access,
    private readonly store: Store,
  ) {}

  async require(org: string, id: string, member: Member) {
    validate(uuid, id);
    const result = await this.store.pool.query(
      `
      SELECT c.id FROM channels c WHERE c.org_id=$1 AND c.id=$2 AND
      (c.kind IN ('channel','project') OR EXISTS(SELECT 1 FROM conversation_members m WHERE m.org_id=$1 AND m.channel_id=$2 AND m.user_id=$3))
    `,
      [org, id, member.id],
    );
    if (!result.rowCount)
      throw new NotFoundException("Conversation could not be found.");
  }

  async create(
    org: string,
    member: Member,
    cookie: string | undefined,
    input: {
      kind: string;
      name: string;
      members: string[];
      projectId?: string;
    },
  ) {
    this.access.canWrite(member);
    if (input.kind === "channel") {
      const result = await this.store.pool.query(
        "INSERT INTO channels(org_id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id,name,kind",
        [org, input.name],
      );
      return result.rows[0];
    }
    const snapshot = await this.access.snapshot(org, cookie);
    if (input.kind === "project") {
      if (!snapshot.projects.some((project) => project.id === input.projectId))
        throw new ForbiddenException("Choose a project in this workspace.");
      const result = await this.store.pool.query(
        `
        INSERT INTO channels(org_id,name,kind,project_id) VALUES ($1,$2,'project',$3) ON CONFLICT DO NOTHING RETURNING id,name,kind
      `,
        [org, input.name, input.projectId],
      );
      return result.rows[0];
    }
    const participants = [...new Set([member.id, ...input.members])].sort();
    if (
      participants.some(
        (id) => !snapshot.team.some((person) => person.id === id),
      )
    )
      throw new ForbiddenException("Choose members of this workspace.");
    if (
      (input.kind === "direct" && participants.length !== 2) ||
      (input.kind === "group" && participants.length < 3)
    )
      throw new ForbiddenException(
        "Select the required number of participants.",
      );
    const key = input.kind === "direct" ? participants.join(":") : null;
    const tx = await this.store.pool.connect();
    try {
      await tx.query("BEGIN");
      const result = await tx.query(
        `
        INSERT INTO channels(org_id,name,kind,conversation_key) VALUES ($1,$2,$3,$4)
        ON CONFLICT (org_id,conversation_key) WHERE conversation_key IS NOT NULL
        DO UPDATE SET conversation_key=EXCLUDED.conversation_key RETURNING id,name,kind
        `,
        [org, input.name, input.kind, key],
      );
      for (const id of participants) {
        await tx.query(
          "INSERT INTO conversation_members(org_id,channel_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [org, result.rows[0].id, id],
        );
      }
      await tx.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      tx.release();
    }
  }
}
