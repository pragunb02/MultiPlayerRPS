import http from "node:http";
import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { CHALLENGE_EVENTS } from "../../domain/challenges/challengeComponent.js";
import { ROOM_EVENTS } from "../../domain/rooms/roomComponent.js";
import { createInMemoryAccountDao } from "../../testing/inMemoryAccountDao.js";
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
  it("times each acknowledged event for operations telemetry by name and outcome only (ADR-055)", async () => {
    const recorded = [];
    server = await startTestServer({ metrics: { recordSocketEvent: (event) => recorded.push(event) } });
    const { cookie } = await createGuest();
    const socket = openSocket({ cookie, origin: ALLOWED_ORIGIN });
    await connected(socket);

    await emitWithAck(socket, SOCKET_EVENTS.IDENTITY_GET);
    await emitWithAck(socket, SOCKET_EVENTS.ROOM_JOIN, { code: "AB2CDE" });

    expect(recorded.map(({ event, outcome }) => [event, outcome])).toEqual([
      [SOCKET_EVENTS.IDENTITY_GET, "ok"],
      [SOCKET_EVENTS.ROOM_JOIN, "refused"],
    ]);
    expect(Object.keys(recorded[0]).sort()).toEqual(["durationMs", "event", "outcome"]);
  });

  it("logs a challenge push it could not make, and still sends the player's next one (CC-052)", async () => {
    server = await startTestServer();
    const { cookie, identity } = await createGuest();
    const socket = openSocket({ cookie, origin: ALLOWED_ORIGIN });
    await connected(socket);
    const pushed = new Promise((resolve) => socket.once(SOCKET_EVENTS.CHALLENGE_UPDATED, resolve));
    const challenge = {
      challengeId: "c0000000000000000001",
      fromId: identity.id,
      fromName: identity.displayName,
      fromPublic: false,
      toId: "",
      toName: "",
      gameId: "race",
      options: {},
      state: "open",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      endedAt: 0,
      acceptedBy: "",
      acceptedName: "",
      roomCode: "",
      laterBy: [],
      groupId: "c0000000000000000001",
      filledBy: "",
      filledDone: false,
      keptAt: 0,
    };

    server.domainEvents.emit(CHALLENGE_EVENTS.CHANGED, {
      challenge: { ...challenge, laterBy: undefined },
      playerIds: [identity.id],
    });
    server.domainEvents.emit(CHALLENGE_EVENTS.CHANGED, { challenge, playerIds: [identity.id] });

    expect((await pushed).challenge).toMatchObject({ id: "c0000000000000000001", own: true });
    expect(server.find("pushing a challenge failed")).toHaveLength(1);
  });

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

  it("logs why it refused a connection, without the session id (CC-079)", async () => {
    server = await startTestServer();

    await connected(openSocket({ cookie: "cc.sid=s%3Aforged.signature" })).catch(() => {});

    const [refused] = server.find("socket refused");
    expect(refused).toMatchObject({ level: 40, code: ERROR_CODES.UNAUTHORIZED, sentCookie: true });
    expect(JSON.stringify(refused)).not.toContain("forged");
  });

  it("refuses a connection, and logs it as a server fault, when the session cannot be checked (CC-116)", async () => {
    const accounts = createInMemoryAccountDao();
    let broken = false;
    const accountDao = {
      ...accounts,
      getSessionVersion: async (accountId) => {
        if (broken) throw new Error("database down");
        return accounts.getSessionVersion(accountId);
      },
    };
    server = await startTestServer({ accountDao });
    const res = await fetch(`${server.baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Riya",
        email: "riya@example.com",
        password: "correct horse battery",
      }),
    });
    const cookie = res.headers.get("set-cookie").split(";")[0];
    broken = true;

    const error = await connected(openSocket({ cookie })).catch((err) => err);

    expect(error.data).toEqual({ code: ERROR_CODES.INTERNAL });
    expect(server.find("checking a socket's session failed")[0].err.message).toBe("database down");
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
    const room = await server.roomComponent.getRoom(created.data.code);

    // A room whose game the server can't render a view for.
    server.domainEvents.emit(ROOM_EVENTS.UPDATED, { room: { ...room, gameId: "no-such-game" } });

    await expect.poll(() => server.find("failed to broadcast room update")).toHaveLength(1);
  });

  it("finishes closing while a browser keeps reusing a connection that was busy when closing began", async () => {
    const own = await startTestServer(); // closed here, not by afterEach
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const get = () =>
      new Promise((resolve) => {
        http
          .get(`${own.baseUrl}/api/session`, { agent }, (res) => {
            res.resume();
            res.on("end", () => resolve(true));
          })
          .on("error", () => resolve(false));
      });
    let closed = false;
    // A request still being sent when closing begins keeps its connection busy.
    const busy = http.request(`${own.baseUrl}/api/session`, {
      method: "POST",
      agent,
      headers: { "content-type": "text/plain", "content-length": "2" },
    });
    const answered = new Promise((resolve) => busy.on("response", (res) => res.resume().on("end", resolve)));
    const arrived = new Promise((resolve) => own.httpServer.once("request", resolve));
    busy.write("a");
    await arrived;

    const closing = own.gateway.close().then(() => {
      closed = true;
    });
    busy.end("b");
    await answered;
    // Like a browser polling to reconnect: the next request goes out on the same connection right away.
    const reuse = (async () => {
      const deadline = Date.now() + 3_000;
      while (!closed && Date.now() < deadline && (await get()));
    })();
    const tooLate = new Promise((resolve) => setTimeout(resolve, 1_000, "still open"));

    await expect(Promise.race([closing.then(() => "closed"), tooLate])).resolves.toBe("closed");
    await reuse;
    agent.destroy();
    await own.tasks.drain();
  });

  it("tells every connected player that the server is restarting before it cuts them off (CC-158)", async () => {
    const own = await startTestServer(); // closed here, not by afterEach
    const res = await fetch(`${own.baseUrl}/api/session/guest`, { method: "POST" });
    const cookie = res.headers.get("set-cookie").split(";")[0];
    const socket = connect(own.baseUrl, {
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await connected(socket);
    const heard = [];
    socket.onAny((event) => heard.push(event));
    const cut = new Promise((resolve) => socket.once("disconnect", resolve));

    await own.gateway.close();
    await cut;

    expect(heard).toEqual([SOCKET_EVENTS.SERVER_RESTARTING]);
    await own.tasks.drain();
  });

  it("reports closing an already closed gateway", async () => {
    const own = await startTestServer(); // closed here, not by afterEach
    await own.gateway.close();

    await expect(own.gateway.close()).rejects.toThrow("Server is not running");
    await own.tasks.drain();
  });
});
