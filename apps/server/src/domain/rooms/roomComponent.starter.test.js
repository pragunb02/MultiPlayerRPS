import { describe, expect, it } from "vitest";
import { createEngineRegistry, ENGINES, replayGame } from "@classicade/games";
import { GAME_IDS, ROOM_REQUEST_TYPES } from "@classicade/shared";
import { createRoomAccessor } from "../../data/roomAccessor.js";
import { botRooms, PERSON } from "../../testing/botRooms.js";
import { createInMemoryRoomDao } from "../../testing/inMemoryRoomDao.js";
import { TEST_SEAT_IDS } from "../../testing/seatIds.js";
import { createRoomComponent } from "./roomComponent.js";

// Who moves first in a rematch (CC-091, BUG-23). Seed 42 gives the first move to the second seat and seed 7 to the
// first. A rematch reverses the seats, so with the seeds 42, 7, 42 a draw from the seed would give Bob the first
// move in every game. Each rematch must give it to the player who did not start the game before.

const ALICE = Object.freeze({ kind: "guest", id: "guest_a", displayName: "Alice" });
const BOB = Object.freeze({ kind: "guest", id: "guest_b", displayName: "Bob" });
const CODE = "ROOM22";
const SEEDS = [42, 7, 42, 7];
const engines = createEngineRegistry(ENGINES);

/** Room components over one store, so a second component is the same server after a restart. */
function storage() {
  const roomAccessor = createRoomAccessor({ roomDao: createInMemoryRoomDao() });
  let game = 0;
  let matchNumber = 0;
  const server = () =>
    createRoomComponent({
      seatIds: TEST_SEAT_IDS,
      roomAccessor,
      engines,
      events: { emit: () => {} },
      generateCode: () => CODE,
      generateSeed: () => SEEDS[game++],
      generateMatchId: () => `m${++matchNumber}`,
    });
  return { server };
}

/** Who moves first in a game that has just started: the one player the engine lets move. */
const starterOf = (room) => {
  expect(room.game.log).toEqual([]);
  return engines.get(room.gameId).activePlayers(room.game.state)[0];
};

/** Plays the game out: the player to move takes the first free cell (Tic Tac Toe) or resigns (chess). */
async function playOut(rooms, room, now) {
  let current = room;
  let at = now;
  while (current.status === "playing") {
    const [playerId] = engines.get(current.gameId).activePlayers(current.game.state);
    const move =
      current.gameId === GAME_IDS.CHESS
        ? { type: "resign" }
        : { cell: current.game.state.board.findIndex((cell) => cell === "") };
    current = await rooms.makeMove({ code: current.code, playerId, move, now: ++at });
  }
  return current;
}

/** Bob asks for a rematch and Alice says yes. */
async function rematch(rooms, now) {
  await rooms.askRequest({ code: CODE, playerId: BOB.id, type: ROOM_REQUEST_TYPES.REMATCH, now });
  return rooms.answerRequest({
    code: CODE,
    playerId: ALICE.id,
    type: ROOM_REQUEST_TYPES.REMATCH,
    answer: "accept",
    now: now + 1,
  });
}

async function firstGame(rooms, gameId, options) {
  await rooms.createRoom({ network: "net-a", host: ALICE, gameId, options, now: 1_000 });
  return rooms.joinRoom({ code: CODE, player: BOB, now: 1_001 });
}

describe.each([
  { gameId: GAME_IDS.TIC_TAC_TOE, options: {} },
  { gameId: GAME_IDS.CHESS, options: { timeControl: "blitz-5+0" } },
])("roomComponent rematch starter in $gameId (CC-091)", ({ gameId, options }) => {
  it("alternates who moves first over a series of three games, whatever the seed says", async () => {
    const rooms = storage().server();
    const game1 = await firstGame(rooms, gameId, options);

    const game2 = await rematch(rooms, (await playOut(rooms, game1, 1_100)).finishedAt + 1);
    const game3 = await rematch(rooms, (await playOut(rooms, game2, 1_200)).finishedAt + 1);

    expect([game1, game2, game3].map(starterOf)).toEqual([BOB.id, ALICE.id, BOB.id]);
    expect([game1, game2, game3].map((room) => room.game.number)).toEqual([1, 2, 3]);
    // Game 1 is drawn from the seed and records no starter. Each rematch records the one it was given.
    expect([game1, game2, game3].map((room) => room.game.starter)).toEqual([undefined, ALICE.id, BOB.id]);
  });

  it("keeps alternating after the server restarts in the middle of the series", async () => {
    const store = storage();
    const before = store.server();
    const game1 = await firstGame(before, gameId, options);
    const game2 = await rematch(before, (await playOut(before, game1, 1_100)).finishedAt + 1);
    const finished2 = await playOut(before, game2, 1_200);

    const after = store.server();
    await after.markEveryoneAway({ now: finished2.finishedAt + 1 });
    const game3 = await rematch(after, finished2.finishedAt + 2);

    expect([game1, game2, game3].map(starterOf)).toEqual([BOB.id, ALICE.id, BOB.id]);
  });

  it("names the starter by the account of a guest who signs in during the rematch game", async () => {
    const rooms = storage().server();
    const game1 = await firstGame(rooms, gameId, options);
    await rematch(rooms, (await playOut(rooms, game1, 1_100)).finishedAt + 1);
    const account = { kind: "user", id: "user_a", displayName: "alice" };

    await rooms.transferPlayer({ from: ALICE.id, to: account, now: 1_300 });

    const room = await rooms.getRoom(CODE);
    expect(room.game.starter).toBe("user_a");
    expect(engines.get(gameId).starterOf(room.game.state)).toBe("user_a");
  });

  it("replays a rematch game exactly from its seed, its starter and its log", async () => {
    const rooms = storage().server();
    const game1 = await firstGame(rooms, gameId, options);
    const game2 = await rematch(rooms, (await playOut(rooms, game1, 1_100)).finishedAt + 1);
    const finished = await playOut(rooms, game2, 1_200);

    const replayed = replayGame(engines.get(gameId), {
      players: finished.seats.map((seat) => seat.playerId),
      options: finished.options,
      seed: finished.game.seed,
      starter: finished.game.starter,
      log: finished.game.log,
    });

    expect(replayed).toEqual(finished.game.state);
  });
});

describe("roomComponent rematch starter in other games (CC-091)", () => {
  it("leaves Rock Paper Scissors as it was: both move at once, so a rematch records no starter", async () => {
    const rooms = storage().server();
    await rooms.createRoom({
      network: "net-a",
      host: ALICE,
      gameId: GAME_IDS.RPS,
      options: { bestOf: 1 },
      now: 1,
    });
    await rooms.joinRoom({ code: CODE, player: BOB, now: 2 });
    await rooms.makeMove({ code: CODE, playerId: ALICE.id, move: { choice: "rock" }, now: 3 });
    const finished = await rooms.makeMove({
      code: CODE,
      playerId: BOB.id,
      move: { choice: "paper" },
      now: 4,
    });

    const next = await rematch(rooms, finished.finishedAt + 1);

    expect(next.status).toBe("playing");
    expect(next.game).not.toHaveProperty("starter");
  });

  it("alternates in a game against a computer character, which says yes through the same rematch", async () => {
    // Seeds 6 and 7 give the first move to the second seat and then the first, so a draw from the seed would let
    // the computer start both games.
    const setup = botRooms({ seed: 6 });
    const game1 = await setup.playComputer({ gameId: GAME_IDS.TIC_TAC_TOE });
    const bot = game1.seats.find((seat) => seat.bot !== undefined).playerId;
    const finished = await playOut(setup.rooms, game1, 1_100);
    await setup.rooms.askRequest({
      code: finished.code,
      playerId: PERSON.id,
      type: ROOM_REQUEST_TYPES.REMATCH,
      now: finished.finishedAt + 1,
    });

    const game2 = await setup.botComponent.acceptRematch({
      code: finished.code,
      playerId: bot,
      now: finished.finishedAt + 2,
    });

    expect([game1, game2].map(starterOf)).toEqual([bot, PERSON.id]);
  });
});
