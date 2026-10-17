import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, ROOM_LIMIT_REASONS, SOCKET_EVENTS } from "@classicade/shared";
import { roomLimits } from "../../domain/rooms/roomLimits.js";
import { createSocketClients, send } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";
import { SOCKET_REFUSALS } from "./socketAdmission.js";

// The realtime side of the room flood limits (CC-107), through real sessions and real connections.
let server;
const clients = createSocketClients(() => server.baseUrl);
const extra = [];

afterEach(async () => {
  clients.disconnectAll();
  extra.splice(0).forEach((socket) => socket.disconnect());
  await server?.close();
  server = undefined;
});

/** A connection that says it comes from `address`, as Render's proxy would write it. */
function socketFrom({ cookie, address }) {
  const socket = connect(server.baseUrl, {
    transports: ["websocket"],
    extraHeaders: { cookie, "X-Forwarded-For": address },
    reconnection: false,
  });
  extra.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

/** A guest session without any connection yet. */
async function guestCookie() {
  const res = await fetch(`${server.baseUrl}/api/session/guest`, { method: "POST" });
  return res.headers.get("set-cookie").split(";")[0];
}

const createRace = (socket) =>
  send(socket, SOCKET_EVENTS.ROOM_CREATE, { gameId: "race", options: { target: 3 } });

describe("realtime limits (CC-107)", () => {
  it("refuses a sixth tab of one session, and lets it in once another tab closes", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    const tabs = [alice.socket];
    for (let i = 0; i < 4; i++) tabs.push(await clients.openSocket(alice.cookie));

    const sixth = await clients.openSocket(alice.cookie).catch((err) => err);
    tabs[0].disconnect();
    await expect
      .poll(() =>
        clients.openSocket(alice.cookie).then(
          () => "in",
          () => "out",
        ),
      )
      .toBe("in");

    expect(sixth.data).toEqual({ code: ERROR_CODES.RATE_LIMITED });
    expect(sixth.message).toBe(SOCKET_REFUSALS.SESSION);
  });

  it("caps connections per network address behind the trusted proxy, and other addresses are not affected", async () => {
    server = await startTestServer({
      env: { TRUST_PROXY_HOPS: "1" },
      roomLimits: roomLimits({ socketsPerAddress: 2 }),
    });
    const cookies = [await guestCookie(), await guestCookie(), await guestCookie()];
    await socketFrom({ cookie: cookies[0], address: "203.0.113.7" });
    await socketFrom({ cookie: cookies[1], address: "203.0.113.7" });

    const third = await socketFrom({ cookie: cookies[2], address: "203.0.113.7" }).catch((err) => err);
    const forged = await socketFrom({ cookie: cookies[2], address: "1.2.3.4, 203.0.113.7" }).catch(
      (err) => err,
    );
    const elsewhere = await socketFrom({ cookie: cookies[2], address: "198.51.100.2" });

    expect(third.message).toBe(SOCKET_REFUSALS.ADDRESS);
    expect(forged.message).toBe(SOCKET_REFUSALS.ADDRESS); // a made-up entry on the left changes nothing
    expect(elsewhere.connected).toBe(true);
  });

  it("gives a player one event budget for all their tabs together", async () => {
    server = await startTestServer({
      roomLimits: roomLimits({ eventBurstPerPlayer: 4, eventsPerSecondPerPlayer: 1 }),
    });
    const alice = await clients.player();
    const secondTab = await clients.openSocket(alice.cookie);

    const acks = await Promise.all([
      ...Array.from({ length: 3 }, () => send(alice.socket, SOCKET_EVENTS.IDENTITY_GET)),
      ...Array.from({ length: 3 }, () => send(secondTab, SOCKET_EVENTS.IDENTITY_GET)),
    ]);

    expect(acks.filter((ack) => ack.ok)).toHaveLength(4);
    expect(acks.filter((ack) => !ack.ok).map((ack) => ack.error.code)).toEqual([
      ERROR_CODES.RATE_LIMITED,
      ERROR_CODES.RATE_LIMITED,
    ]);
  });

  it("answers a fourth waiting room with the friendly message", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    for (let i = 0; i < 3; i++) expect((await createRace(alice.socket)).ok).toBe(true);

    const fourth = await createRace(alice.socket);

    expect(fourth).toEqual({
      ok: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message: "You already have 3 rooms waiting; close one first",
        details: { reason: ROOM_LIMIT_REASONS.WAITING_ROOMS, limit: 3 },
      },
    });
  });

  it("answers server busy once the server holds as many rooms as it can", async () => {
    server = await startTestServer({ roomLimits: roomLimits({ openRoomsMax: 1 }) });
    const alice = await clients.player();
    const bob = await clients.player();
    await createRace(alice.socket);

    const refused = await createRace(bob.socket);

    expect(refused).toEqual({
      ok: false,
      error: {
        code: ERROR_CODES.SERVER_BUSY,
        message: "The server is busy, try again in a minute",
        details: { reason: ROOM_LIMIT_REASONS.SERVER_FULL },
      },
    });
  });

  it("counts connections for the gauge and forgets them when they close", async () => {
    server = await startTestServer();
    const alice = await clients.player();
    await clients.openSocket(alice.cookie);
    await clients.player();
    expect(server.gateway.counts()).toEqual({ connections: 3, players: 2 });

    clients.disconnectAll();

    await expect.poll(() => server.gateway.counts()).toEqual({ connections: 0, players: 0 });
  });
});
