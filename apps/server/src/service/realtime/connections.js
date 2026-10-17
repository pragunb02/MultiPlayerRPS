/**
 * Lets an HTTP server finish closing while browsers still hold connections to it. `server.close()` waits for
 * every connection to end, and Node's `closeIdleConnections()` misses two kinds a browser keeps open:
 * 1. A spare connection Chrome opens ahead of time and has not sent a request on yet. Node never counts it as
 *    idle, so it stays open and the server never finishes closing.
 * 2. A keep-alive connection that was busy when closing began. Node keeps serving it for as long as the browser
 *    reuses it, and a reconnecting player reuses it every few seconds.
 * While closing, every answer therefore says `Connection: close`, and `closeIdle()` ends every connection that has
 * no request in flight. WebSocket connections belong to Socket.IO, which closes them itself.
 *
 * @param {import("node:http").Server} httpServer
 */
export function trackConnections(httpServer) {
  /** Requests in flight per connection. */
  const inFlight = new Map();
  let closing = false;

  httpServer.on("connection", (socket) => {
    inFlight.set(socket, 0);
    socket.once("close", () => inFlight.delete(socket));
  });
  httpServer.on("upgrade", (req) => inFlight.delete(req.socket));
  httpServer.prependListener("request", (req, res) => {
    const { socket } = req;
    if (closing) res.setHeader("Connection", "close");
    inFlight.set(socket, inFlight.get(socket) + 1);
    res.once("close", () => {
      if (!inFlight.has(socket)) return;
      inFlight.set(socket, inFlight.get(socket) - 1);
      if (closing && inFlight.get(socket) === 0) socket.end();
    });
  });

  return Object.freeze({
    /** From now on connections close after their answer. The ones with nothing in flight close now. */
    closeIdle() {
      closing = true;
      for (const [socket, requests] of inFlight) {
        if (requests === 0) socket.destroy();
      }
    },
  });
}
