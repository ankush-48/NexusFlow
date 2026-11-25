import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { ApiError } from "./api";
import { openWorkspaceSocket } from "./live-socket";

class TestConnection extends EventEmitter {
  active = false;
  connect = vi.fn();
  disconnect = vi.fn();
}

let connection: TestConnection;
vi.mock("socket.io-client", () => ({ io: () => connection }));

describe("workspace socket renewal", () => {
  beforeEach(() => {
    connection = new TestConnection();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("checks current membership before reconnecting after an access-cookie rotation", async () => {
    const membership = vi.fn().mockResolvedValue({});
    const live = openWorkspaceSocket(membership);
    connection.emit("disconnect", "io server disconnect");
    await vi.advanceTimersByTimeAsync(1000);
    expect(membership).toHaveBeenCalledTimes(1);
    expect(connection.connect).toHaveBeenCalledTimes(1);
    live.close();
  });

  it("stops retrying when sign-in has ended", async () => {
    const membership = vi.fn().mockRejectedValue(new ApiError("Sign in", 401));
    const onDenied = vi.fn();
    const live = openWorkspaceSocket(membership, onDenied);
    connection.emit("connect_error", new Error("Session ended"));
    await vi.advanceTimersByTimeAsync(120000);
    expect(membership).toHaveBeenCalledTimes(1);
    expect(connection.connect).not.toHaveBeenCalled();
    expect(onDenied).toHaveBeenCalledTimes(1);
    live.close();
  });

  it("backs off on a service outage and cancels reconnect work on unmount", async () => {
    const membership = vi.fn().mockRejectedValueOnce(new ApiError("Unavailable", 503)).mockResolvedValue({});
    const live = openWorkspaceSocket(membership);
    connection.emit("connect_error", new Error("Unavailable"));
    await vi.advanceTimersByTimeAsync(2999);
    expect(membership).toHaveBeenCalledTimes(1);
    live.close();
    await vi.advanceTimersByTimeAsync(10000);
    expect(connection.connect).not.toHaveBeenCalled();
    expect(membership).toHaveBeenCalledTimes(1);
  });
});
