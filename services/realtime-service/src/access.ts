import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { z } from "zod";
import { config } from "./config.js";

export const uuid = z.uuid();
export type Member = { id: string; name: string; role: string };

export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BadRequestException("Invalid request data.");
  return parsed.data;
}
export function verifyOrigin(origin?: string, fetchSite?: string) {
  if ((origin && origin !== config.origin) || fetchSite === "cross-site")
    throw new ForbiddenException("Request origin is not allowed.");
}

@Injectable()
export class Access {
  async account(cookie?: string) {
    return this.request<{ id: string }>("/api/auth/me", cookie);
  }
  async member(org: string, cookie?: string) {
    validate(uuid, org);
    return this.request<Member>("/api/orgs/" + org + "/membership", cookie);
  }
  async snapshot(org: string, cookie?: string) {
    validate(uuid, org);
    return this.request<{ team: { id: string }[]; projects: { id: string }[] }>(
      "/api/orgs/" + org + "/snapshot",
      cookie,
    );
  }
  canWrite(member: Member) {
    if (!["Owner", "Admin", "Project Manager", "Member"].includes(member.role))
      throw new ForbiddenException(
        "Your workspace role does not allow this action.",
      );
  }
  private async request<T>(path: string, cookie?: string): Promise<T> {
    const accessCookie = cookie?.split(";").map((part) => part.trim())
      .find((part) => /^nf_access=[A-Za-z0-9_-]{43}$/.test(part));
    if (!accessCookie)
      throw new UnauthorizedException("Sign in to continue.");
    const response = await fetch(config.core + path, {
      headers: { cookie: accessCookie },
      redirect: "error",
      signal: AbortSignal.timeout(4000),
    }).catch(() => {
      throw new ServiceUnavailableException(
        "Workspace authorization is temporarily unavailable.",
      );
    });
    if (response.status === 401)
      throw new UnauthorizedException("Sign in to continue.");
    if (response.status === 403)
      throw new ForbiddenException("You do not belong to this workspace.");
    if (!response.ok)
      throw new ServiceUnavailableException(
        "Workspace authorization is temporarily unavailable.",
      );
    return response.json() as Promise<T>;
  }
}
