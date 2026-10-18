import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { createInMemoryPendingMatchDao } from "./testing/inMemoryPendingMatchDao.js";
import { createSocketClients, nextEvent, send } from "./testing/socketClients.js";
import { startTestServer } from "./testing/testApp.js";

// CC-111: the outbox add right after a game can fail (an Atlas blip). The finished room still holds the game, and
// the room keeps it in the outbox before a rematch or a closing room takes it away.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

/** The in-memory outbox, whose next `failures` adds fail as a database blip would. */
function blippingOutbox(failures) {
  const dao = createInMemoryPendingMatchDao();
  let left = failures;
  return {
    ...dao,
    async insertIfAbsent(doc) {
      if (left > 0) {
        left -= 1;
        throw new Error("db blip");
      }
      return dao.insertIfAbsent(doc);
    },
  };
}

/** Alice creates a race room, Bob joins and moves first (seed 42), Alice wins. */
async function finishedRace() {
  const alice = await clients.player();
  const bob = await clients.player();
  const created = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
    gameId: "race",
    options: { target: 3 },
  });
  const code = created.data.code;
  const aliceSeesStart = nextEvent(alice.socket);
  const joined = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code });
  await aliceSeesStart;
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  expect(joined.ok).toBe(true);
  return { alice, bob, code };
}

const progressOf = async (player) =>
  (await (await fetch(`${server.baseUrl}/api/progress`, { headers: { cookie: player.cookie } })).json())
    .progress;

describe("a finished game whose outbox add failed (CC-111)", () => {
  it("is still recorded, with XP exactly once, when both players rematch before anything retried it", async () => {
    server = await startTestServer({ pendingMatchDao: blippingOutbox(1) });
    const { alice, bob, code } = await finishedRace();
    await server.tasks.drain();
    expect(server.find("background task failed")[0]).toEqual(
      expect.objectContaining({ task: "match pipeline", roomCode: code }),
    );

    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });
    const rematch = await send(alice.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });
    server.matchPipeline.runDue();
    await server.tasks.drain();
    server.matchPipeline.runDue();
    await server.tasks.drain();

    expect(rematch.data.status).toBe("playing");
    expect(server.find("match recorded")).toHaveLength(1);
    expect(await progressOf(alice)).toEqual(
      expect.objectContaining({ xp: expect.any(Number), wins: 1, matchesPlayed: 1 }),
    );
    expect(await progressOf(bob)).toEqual(expect.objectContaining({ losses: 1, matchesPlayed: 1 }));
  });

  it("is still recorded when everyone leaves the finished room before anything retried it", async () => {
    server = await startTestServer({ pendingMatchDao: blippingOutbox(1) });
    const { alice, bob, code } = await finishedRace();
    await server.tasks.drain();

    await send(alice.socket, SOCKET_EVENTS.ROOM_LEAVE, { code });
    await send(bob.socket, SOCKET_EVENTS.ROOM_LEAVE, { code });
    server.matchPipeline.runDue();
    await server.tasks.drain();

    expect(server.find("match recorded")).toHaveLength(1);
    expect(await progressOf(alice)).toEqual(expect.objectContaining({ wins: 1, matchesPlayed: 1 }));
  });
});
