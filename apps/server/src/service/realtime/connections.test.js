import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { trackConnections } from "./connections.js";

const servers = [];

afterEach(() => {
  servers.splice(0).forEach((server) => server.closeAllConnections());
});

/** A server whose `/slow` answer waits for `release()`, and whose upgrades are kept open like a WebSocket. */
async function start() {
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const server = http.createServer((req, res) => {
    if (req.url === "/slow") {
      released.then(() => res.end("slow"));
    } else {
      res.end("ok");
    }
  });
  const upgraded = [];
  server.on("upgrade", (_req, socket) => {
    upgraded.push(socket);
    socket.on("error", () => {}); // the test hangs up on it
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n");
  });
  const connections = trackConnections(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const closed = () => new Promise((resolve) => server.close(resolve));
  return { server, port, connections, release, upgraded, closed };
}

const connect = (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => resolve(socket));
    socket.on("error", () => {}); // the server may reset a connection it ends
  });
const ended = (socket) => new Promise((resolve) => socket.once("close", resolve));

/** Sends one keep-alive request on a raw connection and resolves with the answer's head once it is complete. */
function ask(socket, path) {
  return new Promise((resolve) => {
    let answer = "";
    const onData = (chunk) => {
      answer += chunk;
      if (/\r\n\r\n[\s\S]*(ok|slow)$/.test(answer)) {
        socket.off("data", onData);
        resolve(answer);
      }
    };
    socket.on("data", onData);
    socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n`);
  });
}

describe("trackConnections", () => {
  it("ends a connection that never sent a request, so the server finishes closing", async () => {
    const { port, connections, closed } = await start();
    const spare = await connect(port);
    const spareEnded = ended(spare);

    const finished = closed();
    connections.closeIdle();

    await spareEnded;
    await finished;
  });

  it("ends an idle keep-alive connection", async () => {
    const { port, connections, closed } = await start();
    const socket = await connect(port);
    expect(await ask(socket, "/")).toMatch(/keep-alive/i);
    const socketEnded = ended(socket);

    const finished = closed();
    connections.closeIdle();

    await socketEnded;
    await finished;
  });

  it("lets a request in flight finish, then ends its connection", async () => {
    const { server, port, connections, release, closed } = await start();
    const socket = await connect(port);
    // The request is in flight once the server has it. A 50 ms wait used to stand in for that, and on a busy
    // runner closing began first, so the connection had no request yet and was ended unanswered (CC-345).
    const arrived = new Promise((resolve) => server.once("request", resolve));
    const answer = ask(socket, "/slow");
    await arrived;
    const socketEnded = ended(socket);

    const finished = closed();
    connections.closeIdle();
    release();

    expect(await answer).toMatch(/slow$/);
    await socketEnded;
    await finished;
  });

  it("forgets a connection the browser hung up on in the middle of a request", async () => {
    const { server, port, connections, release, closed } = await start();
    const socket = await connect(port);
    const answered = new Promise((resolve) =>
      server.once("request", (_req, res) => res.once("close", resolve)),
    );
    socket.write("GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await new Promise((resolve) => server.once("request", resolve));
    socket.destroy();
    await answered;

    const finished = closed();
    connections.closeIdle();
    release();

    await finished;
  });

  it("answers with Connection: close once closing has begun", async () => {
    const { port, connections } = await start();

    connections.closeIdle();
    // The server has not stopped listening here, so a new connection still gets an answer, and is told to close.
    const late = await connect(port);
    const lateEnded = ended(late);

    expect(await ask(late, "/")).toMatch(/connection: close/i);
    await lateEnded;
  });

  it("leaves upgraded connections to their owner", async () => {
    const { port, connections, upgraded } = await start();
    const socket = await connect(port);
    socket.write("GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n");
    await new Promise((resolve) => socket.once("data", resolve));

    connections.closeIdle();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(upgraded).toHaveLength(1);
    expect(upgraded[0].destroyed).toBe(false);
    socket.destroy();
  });
});
