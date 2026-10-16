import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { ENGINES } from "@classicade/games";
import { createSocketClients, nextEvent, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// Rock Paper Scissors end to end over real sockets, with the real engine registry.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

async function rpsMatch(bestOf) {
  server = await startTestServer({ engines: ENGINES });
  const alice = await clients.player();
  const bob = await clients.player();
  const { code } = await startRoom(alice, bob, { gameId: "rps", options: { bestOf } });
  return { alice, bob, code };
}

describe("Rock Paper Scissors over sockets", () => {
  it("never sends a pending choice to the opponent — only that they have chosen (SEC-09)", async () => {
    const { alice, bob, code } = await rpsMatch(3);
    const bobSeesAliceChoose = nextEvent(bob.socket);

    const own = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "scissors" } });
    const bobsView = await bobSeesAliceChoose;

    expect(own.data.game.view.yourChoice).toBe("scissors");
    expect(bobsView.game.view.hasChosen).toEqual({ [alice.identity.id]: true, [bob.identity.id]: false });
    expect(bobsView.game.activePlayers).toEqual([bob.identity.id]);
    expect(JSON.stringify(bob.received)).not.toContain("scissors");
  });

  it("plays a best-of-1 match to a result both players see, scissors included (BUG-01)", async () => {
    const { alice, bob, code } = await rpsMatch(1);
    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "scissors" } });
    const aliceSeesResult = nextEvent(alice.socket);

    const final = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "paper" } });

    const outcome = { status: "finished", result: "win", winners: [alice.identity.id], reason: "best-of-1" };
    expect(final.data.game.outcome).toEqual(outcome);
    expect((await aliceSeesResult).game.outcome).toEqual(outcome);
    expect(final.data.game.view.rounds).toEqual([
      { choices: { [alice.identity.id]: "scissors", [bob.identity.id]: "paper" }, winner: alice.identity.id },
    ]);
  });

  it("refuses invalid options and invalid choices with clear reasons", async () => {
    const { alice, code } = await rpsMatch(3);
    const stranger = await clients.player();

    const badOptions = await send(stranger.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "rps",
      options: { bestOf: 4 },
    });
    const badChoice = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "lizard" } });

    expect(badOptions.error.message).toMatch(/bestOf must be one of 1, 3, 5, 7/);
    expect(badChoice.error.details).toEqual({ reason: "INVALID_MOVE" });
  });
});
