import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { ENGINES } from "@classicade/games";
import { createSocketClients, nextEvent, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// Tic-Tac-Toe end to end over real sockets. The test server seeds games with 42, so the second seat starts as X.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

async function tttGame() {
  server = await startTestServer({ engines: ENGINES });
  const alice = await clients.player();
  const bob = await clients.player();
  const room = await startRoom(alice, bob, { gameId: "tictactoe" });
  return { alice, bob, ...room };
}

describe("Tic-Tac-Toe over sockets", () => {
  it("starts with an empty board and the seeded starter as X", async () => {
    const { alice, bob, hostStart } = await tttGame();

    expect(hostStart.game.view).toEqual({
      board: ["", "", "", "", "", "", "", "", ""],
      marks: { [bob.identity.id]: "X", [alice.identity.id]: "O" },
      turn: bob.identity.id,
      winningLine: [],
    });
  });

  it("plays to a win decided by the server, seen by both players", async () => {
    const { alice, bob, code } = await tttGame();
    const moves = [
      [bob, 0],
      [alice, 3],
      [bob, 1],
      [alice, 4],
    ];
    for (const [player, cell] of moves) {
      const ack = await send(player.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell } });
      expect(ack.ok).toBe(true);
    }
    const aliceSeesEnd = nextEvent(alice.socket);

    const final = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell: 2 } });

    const outcome = {
      status: "finished",
      result: "win",
      winners: [bob.identity.id],
      reason: "three-in-a-row",
    };
    expect(final.data.status).toBe("finished");
    expect(final.data.game.outcome).toEqual(outcome);
    const aliceView = await aliceSeesEnd;
    expect(aliceView.game.outcome).toEqual(outcome);
    expect(aliceView.game.view.winningLine).toEqual([0, 1, 2]);
  });

  it("refuses out-of-turn, occupied and out-of-range moves (SEC-04: the client cannot decide)", async () => {
    const { alice, bob, code } = await tttGame();
    await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell: 4 } });

    const outOfTurn = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell: 0 } });
    const occupied = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell: 4 } });
    const offBoard = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell: 9 } });

    expect(outOfTurn.error.details).toEqual({ reason: "NOT_YOUR_TURN" });
    expect(occupied.error.details).toEqual({ reason: "ILLEGAL_MOVE" });
    expect(offBoard.error.details).toEqual({ reason: "INVALID_MOVE" });
    expect(
      [outOfTurn, occupied, offBoard].every((ack) => ack.error.code === ERROR_CODES.VALIDATION_FAILED),
    ).toBe(true);
  });

  it("cannot be ended by a client claiming a result", async () => {
    const { bob, code } = await tttGame();

    const ack = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, {
      code,
      move: { cell: 0, winner: bob.identity.id },
    });
    const room = server.roomComponent.getRoom(code);

    expect(ack.ok).toBe(true);
    expect(room.status).toBe("playing");
    expect(room.game.state.winner).toBe("");
  });
});
