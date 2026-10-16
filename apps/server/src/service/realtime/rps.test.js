import { io as connect } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { ENGINES } from "@classicade/games";
import { startTestServer } from "../../testing/testApp.js";

// Rock Paper Scissors end to end over real sockets, with the real engine registry.
const sockets = [];
let server;

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  await server?.close();
  server = undefined;
});

async function player() {
  const res = await fetch(`${server.baseUrl}/api/session/guest`, { method: "POST" });
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const { identity } = await res.json();
  const socket = connect(server.baseUrl, {
    transports: ["websocket"],
    extraHeaders: { cookie },
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const received = [];
  socket.onAny((event, payload) => received.push({ event, payload }));
  return { identity, socket, received };
}

const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);
const nextUpdate = (socket) => new Promise((resolve) => socket.once(SOCKET_EVENTS.ROOM_UPDATED, resolve));

async function rpsMatch(bestOf) {
  const alice = await player();
  const bob = await player();
  const { data } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
    gameId: "rps",
    options: { bestOf },
  });
  const aliceSeesStart = nextUpdate(alice.socket);
  await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: data.code });
  await aliceSeesStart;
  return { alice, bob, code: data.code };
}

describe("Rock Paper Scissors over sockets", () => {
  it("never sends a pending choice to the opponent — only that they have chosen (SEC-09)", async () => {
    server = await startTestServer({ engines: ENGINES });
    const { alice, bob, code } = await rpsMatch(3);
    const bobSeesAliceChoose = nextUpdate(bob.socket);

    const own = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "scissors" } });
    const bobsView = await bobSeesAliceChoose;

    expect(own.data.game.view.yourChoice).toBe("scissors");
    expect(bobsView.game.view.hasChosen).toEqual({ [alice.identity.id]: true, [bob.identity.id]: false });
    expect(bobsView.game.activePlayers).toEqual([bob.identity.id]);
    expect(JSON.stringify(bob.received)).not.toContain("scissors");
  });

  it("plays a best-of-1 match to a result both players see, scissors included (BUG-01)", async () => {
    server = await startTestServer({ engines: ENGINES });
    const { alice, bob, code } = await rpsMatch(1);
    await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "scissors" } });
    const aliceSeesResult = nextUpdate(alice.socket);

    const final = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "paper" } });

    const outcome = { status: "finished", result: "win", winners: [alice.identity.id], reason: "best-of-1" };
    expect(final.data.game.outcome).toEqual(outcome);
    expect((await aliceSeesResult).game.outcome).toEqual(outcome);
    expect(final.data.game.view.rounds).toEqual([
      { choices: { [alice.identity.id]: "scissors", [bob.identity.id]: "paper" }, winner: alice.identity.id },
    ]);
  });

  it("refuses invalid options and invalid choices with clear reasons", async () => {
    server = await startTestServer({ engines: ENGINES });
    const { alice, code } = await rpsMatch(3);
    const stranger = await player();

    const badOptions = await send(stranger.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "rps",
      options: { bestOf: 4 },
    });
    const badChoice = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "lizard" } });

    expect(badOptions.error.message).toMatch(/bestOf must be one of 1, 3, 5, 7/);
    expect(badChoice.error.details).toEqual({ reason: "INVALID_MOVE" });
  });
});
