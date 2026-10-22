import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, ROOM_JOIN_REFUSALS, SOCKET_EVENTS } from "@classicade/shared";
import {
  createSocketClients,
  eventWhere,
  nextEvent as nextUpdate,
  send,
} from "../../testing/socketClients.js";
import { roomLimits } from "../../domain/rooms/roomLimits.js";
import { startTestServer } from "../../testing/testApp.js";

let server;
const clients = createSocketClients(() => server.baseUrl);
const player = () => clients.player();
const openSocket = (cookie) => clients.openSocket(cookie);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

/** Alice creates a race room and Bob joins; seed 42 makes Bob (second seat) move first. */
async function startedRace() {
  const alice = await player();
  const bob = await player();
  const created = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
    gameId: "race",
    options: { target: 3 },
  });
  const code = created.data.code;
  const aliceSeesStart = nextUpdate(alice.socket);
  const joined = await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code });
  // Each player's seat id, as their own view tells them: views name players by seat id only (CC-253).
  const seat = { alice: created.data.you, bob: joined.data.you };
  return { alice, bob, code, created, joined, seat, aliceStart: await aliceSeesStart };
}

describe("rooms over sockets", () => {
  it("creates a waiting room seated with the creator's session identity", async () => {
    server = await startTestServer();
    const alice = await player();

    const ack = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "race",
      options: { target: 3 },
    });

    expect(ack.ok).toBe(true);
    const you = ack.data.you;
    expect(you).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(ack.data).toEqual(
      expect.objectContaining({
        gameId: "race",
        status: "waiting",
        hostId: you,
        you,
        seats: [
          expect.objectContaining({
            playerId: you,
            displayName: alice.identity.displayName,
            connected: true,
            presence: "here",
          }),
        ],
      }),
    );
    expect(ack.data.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  it("starts the game when the second player joins and tells the first", async () => {
    server = await startTestServer();

    const { seat, joined, aliceStart } = await startedRace();

    expect(joined.data.status).toBe("playing");
    expect(joined.data.you).toBe(seat.bob);
    expect(aliceStart.status).toBe("playing");
    expect(aliceStart.you).toBe(seat.alice);
    expect(aliceStart.game.activePlayers).toEqual([seat.bob]);
  });

  it("plays a full game: moves are validated by the engine and both sides see every move", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await startedRace();

    const aliceSeesMove = nextUpdate(alice.socket);
    const afterBob = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
    expect(afterBob.data.game.view.count).toBe(1);
    expect((await aliceSeesMove).game.activePlayers).toEqual([seat.alice]);

    const bobSeesEnd = nextUpdate(bob.socket);
    const final = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });

    const outcome = {
      status: "finished",
      result: "win",
      winners: [seat.alice],
      reason: "reached-target",
    };
    expect(final.data.status).toBe("finished");
    expect(final.data.game.outcome).toEqual(outcome);
    expect((await bobSeesEnd).game.outcome).toEqual(outcome);
  });

  it("rejects an out-of-turn move with the engine's reason", async () => {
    server = await startTestServer();
    const { alice, code } = await startedRace();

    const ack = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });

    expect(ack).toEqual({
      ok: false,
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Wait for your turn",
        details: { reason: "NOT_YOUR_TURN" },
      },
    });
  });

  it("cannot move on someone else's behalf (the payload cannot choose the player)", async () => {
    server = await startTestServer();
    const { alice, bob, code } = await startedRace();

    const ack = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, {
      code,
      move: { add: 1 },
      playerId: bob.identity.id,
    });

    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it.each([
    ["an unknown room", { code: "ZZZZZZ" }, ERROR_CODES.NOT_FOUND],
    ["a malformed code", { code: "nope" }, ERROR_CODES.VALIDATION_FAILED],
  ])("refuses to join %s", async (_label, payload, code) => {
    server = await startTestServer();
    const carol = await player();

    const ack = await send(carol.socket, SOCKET_EVENTS.ROOM_JOIN, payload);

    expect(ack.error.code).toBe(code);
  });

  it("refuses a third player once the game has started", async () => {
    server = await startTestServer();
    const { code } = await startedRace();
    const carol = await player();

    const ack = await send(carol.socket, SOCKET_EVENTS.ROOM_JOIN, { code });

    expect(ack.error).toEqual({
      code: ERROR_CODES.CONFLICT,
      message: "This game has already started",
      details: { reason: ROOM_JOIN_REFUSALS.STARTED },
    });
  });

  it("refuses unavailable games", async () => {
    server = await startTestServer();
    const alice = await player();

    const ack = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, { gameId: "chess" });

    expect(ack.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("forfeits the game when a player leaves, and tells the opponent", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await startedRace();
    const aliceSeesForfeit = nextUpdate(alice.socket);

    const ack = await send(bob.socket, SOCKET_EVENTS.ROOM_LEAVE, { code });

    expect(ack).toEqual({ ok: true, data: { left: true } });
    expect((await aliceSeesForfeit).game.outcome).toEqual({
      status: "finished",
      result: "win",
      winners: [seat.alice],
      reason: "forfeit",
    });
  });

  it("closes a room when its last player leaves", async () => {
    server = await startTestServer();
    const alice = await player();
    const { data } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "race",
      options: { target: 3 },
    });

    await send(alice.socket, SOCKET_EVENTS.ROOM_LEAVE, { code: data.code });
    const carol = await player();

    expect((await send(carol.socket, SOCKET_EVENTS.ROOM_JOIN, { code: data.code })).error).toEqual({
      code: ERROR_CODES.GONE,
      message: "This room has closed",
      details: { reason: "empty", gameId: "race", closedAt: expect.any(Number) },
    });
  });

  it("answers NOT_FOUND for a code that never was a room", async () => {
    server = await startTestServer();
    const carol = await player();

    expect((await send(carol.socket, SOCKET_EVENTS.ROOM_JOIN, { code: "NEVER2" })).error.code).toBe(
      ERROR_CODES.NOT_FOUND,
    );
  });

  it("shows the opponent as disconnected, and reconnected after they rejoin", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await startedRace();
    const aliceSeesDrop = nextUpdate(alice.socket);

    bob.socket.disconnect();
    const dropped = await aliceSeesDrop;
    expect(dropped.seats.find((s) => s.playerId === seat.bob)).toEqual(
      expect.objectContaining({ connected: false, presence: "offline" }),
    );

    const aliceSeesReturn = eventWhere(alice.socket, (view) => view.seats.every((s) => s.connected));
    const bobAgain = await openSocket(bob.cookie);
    const rejoined = await send(bobAgain, SOCKET_EVENTS.ROOM_JOIN, { code });

    expect(rejoined.data.status).toBe("playing");
    expect((await aliceSeesReturn).seats.map((s) => s.presence)).toEqual(["here", "here"]);
  });

  it("shows a player who went to another page as away at once, and offline once their last tab closes (CC-207)", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await startedRace();
    const bobOf = (view) => view.seats.find((s) => s.playerId === seat.bob);
    const aliceSeesAway = nextUpdate(alice.socket);

    const ack = await send(bob.socket, SOCKET_EVENTS.ROOM_AWAY, { code });

    expect(ack).toEqual({ ok: true, data: { away: true } });
    expect(bobOf(await aliceSeesAway).presence).toBe("away");
    const aliceSeesOffline = nextUpdate(alice.socket);
    bob.socket.disconnect();
    expect(bobOf(await aliceSeesOffline).presence).toBe("offline");
    const aliceSeesOnline = nextUpdate(alice.socket);
    await openSocket(bob.cookie);
    expect(bobOf(await aliceSeesOnline).presence).toBe("away");
  });

  it("keeps a player here while another of their tabs still shows the room, and away once a tab elsewhere is all that is left", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await startedRace();
    const secondTab = await openSocket(bob.cookie);
    await send(secondTab, SOCKET_EVENTS.ROOM_JOIN, { code });
    const homeTab = await openSocket(bob.cookie);

    await send(bob.socket, SOCKET_EVENTS.ROOM_AWAY, { code });
    expect((await server.roomComponent.getRoom(code)).seats.every((s) => s.connected)).toBe(true);
    const aliceSeesAway = nextUpdate(alice.socket);
    secondTab.disconnect();

    const seen = await aliceSeesAway;
    expect(seen.seats.find((s) => s.playerId === seat.bob).presence).toBe("away");
    expect(homeTab.connected).toBe(true);
  });

  it("counts a closing room page as away when its game started a moment before, instead of leaving it (CC-112, CC-207)", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await startedRace();
    const aliceSeesAway = nextUpdate(alice.socket);

    const ack = await send(bob.socket, SOCKET_EVENTS.ROOM_LEAVE, { code, waitingOnly: true });

    expect(ack).toEqual({ ok: true, data: { left: false } });
    const seen = await aliceSeesAway;
    expect(seen.status).toBe("playing");
    expect(seen.seats.find((s) => s.playerId === seat.bob).presence).toBe("away");
  });

  it("refuses away for a room the player has no seat in", async () => {
    server = await startTestServer();
    const { code } = await startedRace();
    const carol = await player();

    expect((await send(carol.socket, SOCKET_EVENTS.ROOM_AWAY, { code })).error.code).toBe(
      ERROR_CODES.FORBIDDEN,
    );
  });

  it("tells a player who connects about the requests still open in their rooms (CC-207)", async () => {
    server = await startTestServer();
    const { seat, alice, bob, code } = await startedRace();
    await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 1 } });
    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { add: 2 } });
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });

    let heard;
    await clients.openSocket(alice.cookie, {
      listen: (socket) => {
        heard = nextUpdate(socket, SOCKET_EVENTS.REQUEST_UPDATED);
      },
    });
    const pushed = await heard;

    expect(pushed).toEqual(
      expect.objectContaining({
        code,
        requests: [expect.objectContaining({ from: seat.bob, to: seat.alice, state: "open" })],
      }),
    );
  });

  it("lets the player still there claim the win once the opponent stayed offline too long (CC-036)", async () => {
    let now = 1_700_000_000_000;
    server = await startTestServer({ now: () => now });
    const { seat, alice, bob, code } = await startedRace();
    const aliceSeesDrop = nextUpdate(alice.socket);
    bob.socket.disconnect();
    await aliceSeesDrop;

    const early = await send(alice.socket, SOCKET_EVENTS.ROOM_CLAIM_WIN, { code });
    now += 60_000;
    const claimed = await send(alice.socket, SOCKET_EVENTS.ROOM_CLAIM_WIN, { code });

    expect(early.error).toEqual(expect.objectContaining({ code: ERROR_CODES.CONFLICT }));
    expect(claimed.data.game.outcome).toEqual({
      status: "finished",
      result: "win",
      winners: [seat.alice],
      reason: "forfeit",
    });
  });

  it("keeps a player connected while another of their tabs is still open", async () => {
    server = await startTestServer();
    const { alice, bob, code } = await startedRace();
    const secondTab = await openSocket(bob.cookie);
    await send(secondTab, SOCKET_EVENTS.ROOM_JOIN, { code });
    let aliceUpdates = 0;
    alice.socket.on(SOCKET_EVENTS.ROOM_UPDATED, () => aliceUpdates++);

    bob.socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(aliceUpdates).toBe(0);
    expect((await server.roomComponent.getRoom(code)).seats.every((s) => s.connected)).toBe(true);
  });

  it("leaves seats as they are while the server shuts down, because the players are not leaving", async () => {
    server = await startTestServer();
    const { code } = await startedRace();
    const { roomComponent } = server;

    await server.close();
    server = undefined;

    expect((await roomComponent.getRoom(code)).seats.map((seat) => seat.connected)).toEqual([true, true]);
  });

  it("announces closed rooms to their players", async () => {
    server = await startTestServer();
    const alice = await player();
    const { data } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "race",
      options: { target: 3 },
    });
    const closed = nextUpdate(alice.socket, SOCKET_EVENTS.ROOM_CLOSED);

    await server.roomComponent.sweepExpired({ now: Date.now() + 24 * 60 * 60 * 1000 });

    expect(await closed).toEqual({ code: data.code, reason: "expired" });
  });

  it("rate-limits a client that floods events", async () => {
    server = await startTestServer({
      roomLimits: roomLimits({ eventBurstPerPlayer: 3, eventsPerSecondPerPlayer: 1 }),
    });
    const alice = await player();

    const acks = await Promise.all(
      Array.from({ length: 5 }, () => send(alice.socket, SOCKET_EVENTS.IDENTITY_GET)),
    );

    expect(acks.filter((a) => a.ok)).toHaveLength(3);
    expect(acks.filter((a) => !a.ok).map((a) => a.error.code)).toEqual([
      ERROR_CODES.RATE_LIMITED,
      ERROR_CODES.RATE_LIMITED,
    ]);
  });
});
