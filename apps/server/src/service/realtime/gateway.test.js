import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { ROOM_EVENTS } from "../../domain/rooms/roomComponent.js";
import { startTestServer } from "../../testing/testApp.js";

const ALLOWED_ORIGIN = "http://localhost:5173"; // from TEST_ENV.ALLOWED_ORIGINS
const sockets = [];
let server;

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  await server?.close();
  server = undefined;
});

async function createGuest() {
  const res = await fetch(`${server.baseUrl}/api/session/guest`, { method: "POST" });
  return { cookie: res.headers.get("set-cookie").split(";")[0], identity: (await res.json()).identity };
}

/** @param {Record<string, string>} headers */
function openSocket(headers = {}) {
  const socket = connect(server.baseUrl, {
    transports: ["websocket"],
    extraHeaders: headers,
    reconnection: false,
  });
  sockets.push(socket);
  return socket;
}

const connected = (socket) =>
  new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });

const emitWithAck = (socket, event, ...args) => socket.timeout(2_000).emitWithAck(event, ...args);

describe("realtime gateway", () => {
  it("refuses connections without a session", async () => {
    server = await startTestServer();

    const error = await connected(openSocket()).catch((err) => err);

    expect(error.data).toEqual({ code: ERROR_CODES.UNAUTHORIZED });
  });

  it("refuses a forged session cookie", async () => {
    server = await startTestServer();

    const error = await connected(openSocket({ cookie: "cc.sid=s%3Aforged.signature" })).catch((err) => err);

    expect(error.data).toEqual({ code: ERROR_CODES.UNAUTHORIZED });
  });

  it("binds the connection to the identity from the session", async () => {
    server = await startTestServer();
    const { cookie, identity } = await createGuest();
    const socket = openSocket({ cookie });
    await connected(socket);

    const ack = await emitWithAck(socket, SOCKET_EVENTS.IDENTITY_GET);

    expect(ack).toEqual({ ok: true, data: identity });
  });

  it("cannot be talked into a different identity by the payload", async () => {
    server = await startTestServer();
    const { cookie, identity } = await createGuest();
    const socket = openSocket({ cookie });
    await connected(socket);

    const ack = await emitWithAck(socket, SOCKET_EVENTS.IDENTITY_GET, {
      identity: { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "admin" },
    });

    expect(ack.data).toEqual(identity);
  });

  it("accepts browsers from an allowed origin", async () => {
    server = await startTestServer();
    const { cookie } = await createGuest();

    await expect(connected(openSocket({ cookie, origin: ALLOWED_ORIGIN }))).resolves.toBeUndefined();
  });

  it("rejects browsers from other origins, even with a valid session cookie", async () => {
    server = await startTestServer();
    const { cookie } = await createGuest();

    await expect(connected(openSocket({ cookie, origin: "https://evil.example" }))).rejects.toThrow();
  });

  it("disconnects the session's sockets when the session ends", async () => {
    server = await startTestServer();
    const { cookie } = await createGuest();
    const socket = openSocket({ cookie });
    await connected(socket);
    const disconnected = new Promise((resolve) => socket.once("disconnect", resolve));

    await fetch(`${server.baseUrl}/api/session`, { method: "DELETE", headers: { cookie } });

    await expect(disconnected).resolves.toBe("io server disconnect");
  });

  it("does not disconnect other players' sockets when one session ends", async () => {
    server = await startTestServer();
    const alice = await createGuest();
    const bob = await createGuest();
    const aliceSocket = openSocket({ cookie: alice.cookie });
    const bobSocket = openSocket({ cookie: bob.cookie });
    await Promise.all([connected(aliceSocket), connected(bobSocket)]);
    const aliceGone = new Promise((resolve) => aliceSocket.once("disconnect", resolve));

    await fetch(`${server.baseUrl}/api/session`, { method: "DELETE", headers: { cookie: alice.cookie } });
    await aliceGone;

    expect(bobSocket.connected).toBe(true);
    expect((await emitWithAck(bobSocket, SOCKET_EVENTS.IDENTITY_GET)).data).toEqual(bob.identity);
  });

  it("logs, instead of crashing, when a room update cannot be sent", async () => {
    server = await startTestServer();
    const guest = await createGuest();
    const socket = openSocket({ cookie: guest.cookie });
    await connected(socket);
    const created = await emitWithAck(socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "race",
      options: { target: 3 },
    });
    const room = server.roomComponent.getRoom(created.data.code);

    // A room whose game the server can't render a view for.
    server.domainEvents.emit(ROOM_EVENTS.UPDATED, { room: { ...room, gameId: "no-such-game" } });

    await expect.poll(() => server.find("failed to broadcast room update")).toHaveLength(1);
  });

  it("reports closing an already closed gateway", async () => {
    const own = await startTestServer(); // closed here, not by afterEach
    await own.gateway.close();

    await expect(own.gateway.close()).rejects.toThrow("Server is not running");
    await own.tasks.drain();
  });
});
