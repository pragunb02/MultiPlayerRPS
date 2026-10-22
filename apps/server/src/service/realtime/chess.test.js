import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { ENGINES } from "@classicade/games";
import { createSocketClients, nextEvent, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// Chess end to end over real sockets. Seed 42: the second seat (bob) plays White.
let server;
let now;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

async function chessGame(timeControl = "bullet-1+0") {
  now = 1_700_000_000_000;
  server = await startTestServer({ engines: ENGINES, now: () => now });
  const alice = await clients.player();
  const bob = await clients.player();
  const room = await startRoom(alice, bob, { gameId: "chess", options: { timeControl } });
  return { alice, bob, ...room, seat: { alice: room.seat.host, bob: room.seat.guest } };
}

const move = (player, code, from, to) =>
  send(player.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { type: "move", from, to } });

describe("Chess over sockets", () => {
  it("plays fool's mate to a server-decided checkmate both players see", async () => {
    const { seat, alice, bob, code, hostStart } = await chessGame();
    expect(hostStart.game.view.colors).toEqual({ [seat.bob]: "w", [seat.alice]: "b" });

    await move(bob, code, "f2", "f3");
    await move(alice, code, "e7", "e5");
    await move(bob, code, "g2", "g4");
    const bobSeesMate = nextEvent(bob.socket);
    const final = await move(alice, code, "d8", "h4");

    const outcome = { status: "finished", result: "win", winners: [seat.alice], reason: "checkmate" };
    expect(final.data.game.outcome).toEqual(outcome);
    const bobView = await bobSeesMate;
    expect(bobView.game.outcome).toEqual(outcome);
    expect(bobView.game.view.moves).toEqual(["f3", "e5", "g4", "Qh4#"]);
  });

  it("refuses illegal moves and moves out of turn", async () => {
    const { alice, bob, code } = await chessGame();

    expect((await move(bob, code, "e2", "e5")).error.details).toEqual({ reason: "ILLEGAL_MOVE" });
    expect((await move(alice, code, "e7", "e5")).error.details).toEqual({ reason: "NOT_YOUR_TURN" });
  });

  it("ends the game when a player resigns", async () => {
    const { seat, alice, bob, code } = await chessGame();
    const bobSeesResignation = nextEvent(bob.socket);

    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { type: "resign" } });

    expect((await bobSeesResignation).game.outcome).toEqual({
      status: "finished",
      result: "win",
      winners: [seat.bob],
      reason: "resignation",
    });
  });

  it("flags a player who stops moving, and pushes the result to both sides (BUG-07)", async () => {
    const { seat, alice, bob, code } = await chessGame("bullet-1+0");
    await move(bob, code, "e2", "e4"); // clocks start; Black (alice) now has 60 s
    const aliceSeesFlag = nextEvent(alice.socket);
    const bobSeesFlag = nextEvent(bob.socket);

    now += 60_000;
    await server.roomComponent.expireDue({ now });

    const outcome = { status: "finished", result: "win", winners: [seat.bob], reason: "timeout" };
    expect((await aliceSeesFlag).game.outcome).toEqual(outcome);
    expect((await bobSeesFlag).game.view.clocks.b).toBe(0);
  });

  it("charges server time, not client claims, to the clock", async () => {
    const { alice, bob, code } = await chessGame("blitz-3+2");
    await move(bob, code, "e2", "e4");
    now += 7_000;

    const ack = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, {
      code,
      move: { type: "move", from: "e7", to: "e5", clockMs: 999_999 },
    });

    expect(ack.data.game.view.clocks).toEqual({ w: 180_000, b: 175_000 }); // 180 − 7 + 2
    expect(ack.data.serverTime).toBe(now); // views carry server time, so clients can show drift-free clocks
  });

  it.each(["constructor", "__proto__", "tostring"])(
    "refuses a hand-made request of kind %s, so no endless draw offer reaches the opponent (security)",
    async (type) => {
      const { bob, code } = await chessGame();

      const ack = await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type });

      expect(ack.error.code).toBe("VALIDATION_FAILED");
      expect((await server.roomComponent.getRoom(code)).requests ?? []).toEqual([]);
    },
  );

  it("tells the offerer when the opponent declines a draw, and the game goes on (CC-104, CC-159)", async () => {
    const { seat, alice, bob, code } = await chessGame();
    const aliceSeesOffer = nextEvent(alice.socket);
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "draw" });
    expect((await aliceSeesOffer).requests).toEqual([
      expect.objectContaining({ type: "draw", from: seat.bob, state: "open" }),
    ]);

    const bobSeesAnswer = nextEvent(bob.socket);
    await send(alice.socket, SOCKET_EVENTS.ROOM_ANSWER, { code, type: "draw", answer: "decline" });

    const answer = await bobSeesAnswer;
    expect(answer.status).toBe("playing");
    expect(answer.requests).toEqual([expect.objectContaining({ state: "declined" })]);
    expect(answer.requestsLeft).toEqual({ draw: 2 });
    expect((await move(bob, code, "e2", "e4")).ok).toBe(true);
  });

  it("tells the opponent when the offerer withdraws, and refuses accepting afterwards (CC-104, CC-159)", async () => {
    const { alice, bob, code } = await chessGame();
    // Alice hears of the offer on her own socket, which may come after Bob's answer. Listening only then could
    // catch the offer and take it for the withdrawal, so she sees the offer first (CC-345).
    const aliceSeesOffer = nextEvent(alice.socket);
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "draw" });
    expect((await aliceSeesOffer).requests).toEqual([expect.objectContaining({ state: "open" })]);
    const aliceSeesWithdrawal = nextEvent(alice.socket);

    await send(bob.socket, SOCKET_EVENTS.ROOM_ANSWER, { code, type: "draw", answer: "withdraw" });

    expect((await aliceSeesWithdrawal).requests).toEqual([expect.objectContaining({ state: "withdrawn" })]);
    const late = await send(alice.socket, SOCKET_EVENTS.ROOM_ANSWER, {
      code,
      type: "draw",
      answer: "accept",
    });
    expect(late.error.message).toBe("That request is no longer open");
  });

  it("ends the game in a draw by agreement once accepted", async () => {
    const { alice, bob, code } = await chessGame();
    await send(bob.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "draw" });

    const accepted = await send(alice.socket, SOCKET_EVENTS.ROOM_ANSWER, {
      code,
      type: "draw",
      answer: "accept",
    });

    expect(accepted.data.game.outcome).toEqual({
      status: "finished",
      result: "draw",
      winners: [],
      reason: "agreement",
    });
  });
});
