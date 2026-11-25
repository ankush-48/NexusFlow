import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createServer } from "node:http";
import { once } from "node:events";
import { io } from "socket.io-client";
import { Access } from "../dist/access.js";
import { Live } from "../dist/socket.js";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const channel = "00000000-0000-4000-8000-000000000101";
const user = { id: "00000000-0000-4000-8000-000000000102", name: "Sam", role: "Member" };
const cleanup = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
  jest.restoreAllMocks();
});

async function fixture() {
  const access = new Access();
  jest.spyOn(access, "account").mockResolvedValue(user);
  jest.spyOn(access, "member").mockResolvedValue(user);
  const conversations = { require: jest.fn().mockResolvedValue(undefined) };
  const live = new Live(access, conversations);
  const server = createServer();
  await live.attach(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => live.onApplicationShutdown());
  const socket = io("http://127.0.0.1:" + server.address().port, {
    autoConnect: false, transports: ["websocket"], reconnection: false,
  });
  cleanup.push(() => socket.disconnect());
  const connected = once(socket, "connect");
  socket.connect();
  await connected;
  return { socket, live, access, conversations };
}

describe("live subscription lifecycle", () => {
  it("orders browser joins and replaces the previous workspace and channel together", async () => {
    const { socket, live } = await fixture();
    const replies = await Promise.all([
      socket.emitWithAck("workspace.join", first),
      socket.emitWithAck("channel.join", { orgId: first, channelId: channel }),
      socket.emitWithAck("workspace.join", second),
    ]);
    expect(replies).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    const local = live.io.sockets.sockets.get(socket.id);
    expect([...local.rooms].sort()).toEqual(
      [socket.id, "workspace:" + second, "user:" + second + ":" + user.id].sort(),
    );
    expect(local.data.channel).toBeUndefined();
    expect(live.localMembers(first)).toEqual([]);
    expect(live.localMembers(second)).toEqual([user.id]);
  });

  it("disconnects a signed-out subscriber on its next authorization check", async () => {
    const { socket, access } = await fixture();
    expect(await socket.emitWithAck("workspace.join", first)).toEqual({ ok: true });
    access.member.mockRejectedValue(new Error("Session ended"));
    const [reason] = await once(socket, "disconnect");
    expect(reason).toBe("io server disconnect");
  }, 25000);
});

describe("core authorization delegation", () => {
  it("sends only the access credential to the identity service", async () => {
    const forward = jest.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(user));
    const token = "a".repeat(43);
    expect(await new Access().account("theme=dark; nf_access=" + token + "; experiment=A")).toEqual(user);
    expect(forward.mock.calls[0][1].headers).toEqual({ cookie: "nf_access=" + token });
    expect(forward.mock.calls[0][1].redirect).toBe("error");
  });

  it("admits only known contributor roles for collaboration writes", () => {
    const access = new Access();
    for (const role of ["Owner", "Admin", "Project Manager", "Member"])
      expect(() => access.canWrite({ ...user, role })).not.toThrow();
    for (const role of ["Viewer", ""])
      expect(() => access.canWrite({ ...user, role })).toThrow();
  });
});
