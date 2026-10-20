import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import {
  createSocketClients,
  eventWhere,
  nextEvent as nextUpdate,
  send,
} from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const REMATCH = "rematch";

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
  const joined = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code });
  await aliceSeesStart;
  await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
  const bobSeesEnd = nextUpdate(bob.socket);
  await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
  await bobSeesEnd;
  // Each player's seat id, as their own view tells them (CC-253).
  return { alice, bob, code, seat: { alice: created.data.you, bob: joined.data.you } };
}

const ask = (player, code) => send(player.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: REMATCH });
const answer = (player, code, reply) =>
  send(player.socket, SOCKET_EVENTS.ROOM_ANSWER, { code, type: REMATCH, answer: reply });

describe("rematch over sockets (CC-037, CC-159)", () => {
  it("tells the opponent about a request, and starts a new game in the same room once accepted", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await finishedRace();

    const aliceSeesRequest = nextUpdate(alice.socket);
    const asked = await ask(bob, code);
    const request = expect.objectContaining({
      type: REMATCH,
      from: seat.bob,
      to: seat.alice,
      state: "open",
    });
    expect(asked.data.requests).toEqual([request]);
    expect((await aliceSeesRequest).requests).toEqual([request]);

    const bobSeesStart = nextUpdate(bob.socket);
    const accepted = await answer(alice, code, "accept");

    expect(accepted.data).toEqual(
      expect.objectContaining({
        code,
        status: "playing",
        series: { games: 1, wins: { [seat.alice]: 1 } },
      }),
    );
    expect(accepted.data.seats.map((seat) => seat.playerId)).toEqual([seat.bob, seat.alice]);
    expect(accepted.data).not.toHaveProperty("rematch");
    const started = await bobSeesStart;
    expect(started.status).toBe("playing");
    expect(started.requests).toEqual([expect.objectContaining({ state: "accepted" })]);
  });

  it("pushes the request to every tab of both players, whatever page they are on (CC-207)", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await finishedRace();
    const homeTab = await clients.openSocket(alice.cookie);
    // Connecting tells the tab about the room first, with no request yet.
    const homeTabHears = eventWhere(
      homeTab,
      (payload) => payload.requests.length > 0,
      SOCKET_EVENTS.REQUEST_UPDATED,
    );
    const bobHears = nextUpdate(bob.socket, SOCKET_EVENTS.REQUEST_UPDATED);

    await ask(bob, code);

    const pushed = await homeTabHears;
    expect(pushed).toEqual({
      code,
      gameId: "race",
      // Each player is told which seat is theirs (CC-253).
      you: seat.alice,
      names: { [seat.alice]: alice.identity.displayName, [seat.bob]: bob.identity.displayName },
      requests: [expect.objectContaining({ from: seat.bob, state: "open" })],
      serverTime: expect.any(Number),
    });
    const toBob = await bobHears;
    expect(toBob.requests).toEqual(pushed.requests);
    expect(toBob.you).toBe(seat.bob);
  });

  it("records the rematch as a second match", async () => {
    server = await startTestServer();
    const { alice, bob, code } = await finishedRace();
    await ask(bob, code);
    await ask(alice, code);

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
    expect((await aliceSeesLeave).rematch).toEqual(expect.objectContaining({ available: false }));

    const ack = await ask(alice, code);

    expect(ack).toEqual({ ok: false, error: expect.objectContaining({ code: ERROR_CODES.CONFLICT }) });
  });

  it("tells the asker who declined, and refuses asking again at once (CC-104)", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await finishedRace();
    await ask(alice, code);
    const aliceSeesDecline = nextUpdate(alice.socket);

    const declined = await answer(bob, code, "decline");

    const ended = [expect.objectContaining({ from: seat.alice, state: "declined" })];
    expect(declined.data.requests).toEqual(ended);
    expect((await aliceSeesDecline).requests).toEqual(ended);
    const again = await ask(alice, code);
    expect(again.error).toEqual(
      expect.objectContaining({
        code: ERROR_CODES.CONFLICT,
        message: "Wait a few seconds before asking again",
      }),
    );
  });

  it("refuses answers when nothing is open, from spectators, and with malformed payloads", async () => {
    server = await startTestServer();
    const { bob, code } = await finishedRace();
    const carol = await clients.player();

    expect((await answer(bob, code, "decline")).error.code).toBe(ERROR_CODES.CONFLICT);
    expect((await answer(carol, code, "decline")).error.code).toBe(ERROR_CODES.FORBIDDEN);
    expect((await answer(bob, code, "maybe")).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((await answer(bob, "nope", "decline")).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("refuses spectators, unknown kinds and malformed payloads", async () => {
    server = await startTestServer();
    const { alice, code } = await finishedRace();
    const carol = await clients.player();

    expect((await ask(carol, code)).error.code).toBe(ERROR_CODES.FORBIDDEN);
    const truce = await send(alice.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "truce" });
    expect(truce.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    const extra = await send(carol.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: REMATCH, extra: 1 });
    expect(extra.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });
});
