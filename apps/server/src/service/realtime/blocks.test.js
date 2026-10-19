import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, nextEvent, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// CC-044, ADR-053: what a block does to rooms, over real sockets. The pair is never seated together and never
// rematched, both ways, and the blocked player's screen does not change when the block is made.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const REFUSED_REMATCH = {
  ok: false,
  error: { code: ERROR_CODES.CONFLICT, message: "A rematch is not possible now" },
};
const FULL = { ok: false, error: { code: ERROR_CODES.CONFLICT, message: "This room is full" } };

/** Alice hosts a race, Bob joins and moves first (seed 42), Alice wins. */
async function finishedRace(alice, bob) {
  const { code } = await startRoom(alice, bob, { gameId: "race", options: { target: 3 } });
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  const ended = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  return { code, seats: ended.data.seats };
}

async function block(blocker, { code, seats }, blocked) {
  const res = await fetch(`${server.baseUrl}/api/blocks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: blocker.cookie },
    body: JSON.stringify({
      roomCode: code,
      seat: seats.findIndex((s) => s.playerId === blocked.identity.id),
    }),
  });
  expect(res.status).toBe(200);
}

const ask = (player, code) => send(player.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });

describe("blocks in rooms over sockets (CC-044)", () => {
  it("refuses a rematch from either player after a block, and tells the blocked player nothing when it is made", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const room = await finishedRace(alice, bob);
    const before = bob.received.length;

    await block(alice, room, bob);
    const fromBob = await ask(bob, room.code);
    const fromAlice = await ask(alice, room.code);

    const roomNews = [SOCKET_EVENTS.ROOM_UPDATED, SOCKET_EVENTS.REQUEST_UPDATED];
    expect(bob.received.slice(before).filter(({ event }) => roomNews.includes(event))).toEqual([]);
    expect(fromBob).toEqual(REFUSED_REMATCH);
    expect(fromAlice).toEqual(REFUSED_REMATCH);
  });

  it("lets the blocked player's earlier rematch request end unanswered, because the blocker cannot accept it", async () => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const room = await finishedRace(alice, bob);
    const aliceSees = nextEvent(alice.socket);
    await ask(bob, room.code);
    await aliceSees;

    await block(alice, room, bob);
    const accepted = await send(alice.socket, SOCKET_EVENTS.ROOM_ANSWER, {
      code: room.code,
      type: "rematch",
      answer: "accept",
    });

    expect(accepted).toEqual(REFUSED_REMATCH);
  });

  it.each([
    ["the blocked player joins the blocker's room", (alice, bob) => [alice, bob]],
    ["the blocker joins the blocked player's room", (alice, bob) => [bob, alice]],
  ])("refuses the seat when %s, exactly like a full room", async (_, roles) => {
    server = await startTestServer();
    const [alice, bob] = [await clients.player(), await clients.player()];
    const room = await finishedRace(alice, bob);
    await block(alice, room, bob);
    const [host, joiner] = roles(alice, bob);

    const created = await send(host.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "race",
      options: { target: 3 },
    });
    const joined = await send(joiner.socket, SOCKET_EVENTS.ROOM_JOIN, { code: created.data.code });
    const view = await send(host.socket, SOCKET_EVENTS.ROOM_JOIN, { code: created.data.code });

    expect(joined).toEqual(FULL);
    expect(view.data.seats.map((seat) => seat.playerId)).toEqual([host.identity.id]);
  });

  it("keeps the blocker's other rooms open to everyone else", async () => {
    server = await startTestServer();
    const [alice, bob, carol] = [await clients.player(), await clients.player(), await clients.player()];
    const room = await finishedRace(alice, bob);
    await block(alice, room, bob);

    const created = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "race",
      options: { target: 3 },
    });
    const joined = await send(carol.socket, SOCKET_EVENTS.ROOM_JOIN, { code: created.data.code });

    expect(joined.ok).toBe(true);
    expect(joined.data.status).toBe("playing");
  });
});
