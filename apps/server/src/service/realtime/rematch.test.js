import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { createSocketClients, nextEvent as nextUpdate, send } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

/** Alice creates a race room, Bob joins and moves first (seed 42), Alice wins. */
async function finishedRace() {
  const alice = await clients.player();
  const bob = await clients.player();
  const created = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
    gameId: "race",
    options: { target: 3 },
  });
  const code = created.data.code;
  const aliceSeesStart = nextUpdate(alice.socket);
  await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code });
  await aliceSeesStart;
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  const bobSeesEnd = nextUpdate(bob.socket);
  await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  await bobSeesEnd;
  return { alice, bob, code };
}

describe("rematch over sockets (CC-037)", () => {
  it("tells the opponent about a request, and starts a new game in the same room once both asked", async () => {
    server = await startTestServer();
    const { alice, bob, code } = await finishedRace();

    const aliceSeesRequest = nextUpdate(alice.socket);
    const asked = await send(bob.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });
    expect(asked.data.rematch).toEqual({
      requestedBy: [bob.identity.id],
      available: true,
      until: expect.any(Number),
      declinedBy: "",
    });
    expect((await aliceSeesRequest).rematch.requestedBy).toEqual([bob.identity.id]);

    const bobSeesStart = nextUpdate(bob.socket);
    const accepted = await send(alice.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });

    expect(accepted.data).toEqual(
      expect.objectContaining({
        code,
        status: "playing",
        series: { games: 1, wins: { [alice.identity.id]: 1 } },
      }),
    );
    expect(accepted.data.seats.map((seat) => seat.playerId)).toEqual([bob.identity.id, alice.identity.id]);
    expect(accepted.data).not.toHaveProperty("rematch");
    expect((await bobSeesStart).status).toBe("playing");
  });

  it("records the rematch as a second match", async () => {
    server = await startTestServer();
    const { alice, bob, code } = await finishedRace();
    await send(bob.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });
    await send(alice.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });

    // Seats reversed: Alice now moves first.
    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
    await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
    await server.tasks.drain();

    const matches = await server.matchComponent.listForPlayer({ playerId: alice.identity.id, limit: 10 });
    expect(matches.map((m) => m.outcomeForYou)).toEqual(["loss", "win"]);
    expect(new Set(matches.map((m) => m.matchId)).size).toBe(2);
  });

  it("refuses a rematch once the opponent left", async () => {
    server = await startTestServer();
    const { alice, bob, code } = await finishedRace();
    const aliceSeesLeave = nextUpdate(alice.socket);
    await send(bob.socket, SOCKET_EVENTS.ROOM_LEAVE, { code });
    expect((await aliceSeesLeave).rematch).toEqual(
      expect.objectContaining({ requestedBy: [], available: false, declinedBy: "" }),
    );

    const ack = await send(alice.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });

    expect(ack).toEqual({ ok: false, error: expect.objectContaining({ code: ERROR_CODES.CONFLICT }) });
  });

  it("tells the asker who declined, and lets them ask again (CC-104)", async () => {
    server = await startTestServer();
    const { alice, bob, code } = await finishedRace();
    await send(alice.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });
    const aliceSeesDecline = nextUpdate(alice.socket);

    const declined = await send(bob.socket, SOCKET_EVENTS.ROOM_REMATCH_DECLINE, { code });

    const expected = {
      requestedBy: [],
      available: true,
      until: expect.any(Number),
      declinedBy: bob.identity.id,
    };
    expect(declined.data.rematch).toEqual(expected);
    expect((await aliceSeesDecline).rematch).toEqual(expected);
    const again = await send(alice.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });
    expect(again.data.rematch).toEqual({
      requestedBy: [alice.identity.id],
      available: true,
      until: expect.any(Number),
      declinedBy: "",
    });
  });

  it("refuses a decline when nobody asked, from spectators, and with malformed payloads", async () => {
    server = await startTestServer();
    const { bob, code } = await finishedRace();
    const carol = await clients.player();
    const decline = (player, payload) => send(player.socket, SOCKET_EVENTS.ROOM_REMATCH_DECLINE, payload);

    expect((await decline(bob, { code })).error.code).toBe(ERROR_CODES.CONFLICT);
    expect((await decline(carol, { code })).error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect((await decline(bob, { code: "nope" })).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("refuses spectators and malformed payloads", async () => {
    server = await startTestServer();
    const { code } = await finishedRace();
    const carol = await clients.player();

    expect((await send(carol.socket, SOCKET_EVENTS.ROOM_REMATCH, { code })).error.code).toBe(
      ERROR_CODES.FORBIDDEN,
    );
    expect((await send(carol.socket, SOCKET_EVENTS.ROOM_REMATCH, { code, extra: 1 })).error.code).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
  });
});
