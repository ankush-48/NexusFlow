import { io } from "socket.io-client";
import { ApiError } from "./api";

export function openWorkspaceSocket(checkMembership: () => Promise<unknown>, onDenied?: () => void) {
  const socket = io({ withCredentials: true, transports: ["websocket", "polling"] });
  let closed = false;
  let retryDelay = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function scheduleReconnect() {
    if (closed || timer || socket.active) return;
    timer = setTimeout(async () => {
      timer = undefined;
      try {
        // The normal HTTP client rotates an expired access cookie before the new handshake.
        await checkMembership();
        if (!closed) socket.connect();
      } catch (error) {
        if (closed) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          onDenied?.();
          return;
        }
        scheduleReconnect();
      }
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  }

  socket.on("connect", () => { retryDelay = 1000; });
  socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect") scheduleReconnect();
  });
  socket.on("connect_error", scheduleReconnect);
  return {
    socket,
    close() {
      closed = true;
      clearTimeout(timer);
      socket.disconnect();
    },
  };
}
