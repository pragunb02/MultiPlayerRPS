import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { ENGINES } from "@classicade/games";
import { createSocketClients, nextEvent, send, startRoom } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// Chess ratings over real sockets (CC-042): the outbox step rates a finished game, the room hears it, and a tab
// asks for the ratings of the room it has open. Seed 42: the second seat (bob) plays White.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const move = (player, code, from, to) =>
  send(player.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { type: "move", from, to } });

/** Alice (Black) mates Bob in two, a game that counts: both players made two moves. */
async function foolsMate(alice, bob, code) {
  await move(bob, code, "f2", "f3");
  await move(alice, code, "e7", "e5");
  await move(bob, code, "g2", "g4");
  await move(alice, code, "d8", "h4");
}

async function chessRoom() {
  server = await startTestServer({ engines: ENGINES });
  const alice = await clients.player();
  const bob = await clients.player();
  const { code, hostStart } = await startRoom(alice, bob, { gameId: "chess", options: {} });
  return { alice, bob, code, matchId: hostStart.game.matchId };
}

const unrated = (playerId) => ({ playerId, rating: 1500, deviation: 350, games: 0, provisional: true });

describe("chess ratings over sockets", () => {
  it("answers the starting rating of both players before their first game", async () => {
    const { alice, bob, code } = await chessRoom();

    const answer = await send(alice.socket, SOCKET_EVENTS.RATING_ROOM, { code });

    expect(answer).toEqual({
      ok: true,
      data: { ratings: [unrated(alice.identity.id), unrated(bob.identity.id)] },
    });
  });

  it("pushes both new ratings to the room after a counted game, and answers them with the change", async () => {
    const { alice, bob, code, matchId } = await chessRoom();
    const bobHears = nextEvent(bob.socket, SOCKET_EVENTS.RATING_UPDATED);

    await foolsMate(alice, bob, code);
    const pushed = await bobHears;
    const answer = await send(bob.socket, SOCKET_EVENTS.RATING_ROOM, { code });

    const winner = {
      playerId: alice.identity.id,
      rating: 1662,
      deviation: 290,
      games: 1,
      provisional: true,
      change: 162,
    };
    const loser = {
      playerId: bob.identity.id,
      rating: 1338,
      deviation: 290,
      games: 1,
      provisional: true,
      change: -162,
    };
    expect(pushed).toEqual({ matchId, ratings: [winner, loser] });
    expect(answer.data.ratings).toEqual([winner, loser]);
  });

  it("refuses a tab that has not opened the room", async () => {
    const { code } = await chessRoom();
    const carol = await clients.player();

    const answer = await send(carol.socket, SOCKET_EVENTS.RATING_ROOM, { code });

    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it("answers no ratings in a game without one", async () => {
    server = await startTestServer({ engines: ENGINES });
    const alice = await clients.player();
    const bob = await clients.player();
    const { code } = await startRoom(alice, bob, { gameId: "rps", options: {} });

    expect((await send(alice.socket, SOCKET_EVENTS.RATING_ROOM, { code })).data).toEqual({ ratings: [] });
  });

  it("refuses a request without a valid room code", async () => {
    const { alice } = await chessRoom();

    const answer = await send(alice.socket, SOCKET_EVENTS.RATING_ROOM, { code: "nope", extra: 1 });

    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("leaves the computer player out of a game against Queen Vee", async () => {
    server = await startTestServer({ engines: ENGINES });
    const alice = await clients.player();
    const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_PLAY_COMPUTER, {
      gameId: "chess",
      level: "hard",
    });

    const answer = await send(alice.socket, SOCKET_EVENTS.RATING_ROOM, { code: room.code });

    expect(answer.data.ratings).toEqual([unrated(alice.identity.id)]);
  });
});
