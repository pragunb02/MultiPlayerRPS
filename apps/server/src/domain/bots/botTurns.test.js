import { describe, expect, it } from "vitest";
import { CHESS_ACTIONS, GAME_IDS, RPS_CHOICES } from "@classicade/shared";
import { botRooms, PERSON } from "../../testing/botRooms.js";
import { ForbiddenError } from "../../utils/errors.js";
import { NO_ACTION, NO_BOT_TURNS } from "./botTurns.js";
import { commitmentOf } from "./seals.js";

const ROCKY = "bot_rocky_easy";
const PIP = "bot_pip_easy";
const VEE = "bot_queen-vee_easy";
const OTHER_CHOICE = Object.freeze({
  [RPS_CHOICES.ROCK]: RPS_CHOICES.PAPER,
  [RPS_CHOICES.PAPER]: RPS_CHOICES.SCISSORS,
  [RPS_CHOICES.SCISSORS]: RPS_CHOICES.ROCK,
});

/** A started game where `first` moves first: tries seeds until the engine's draw gives that order. */
async function startedWith(gameId, first) {
  for (let seed = 1; seed < 50; seed++) {
    const setup = botRooms({ seed });
    const room = await setup.playComputer({ gameId });
    const active = setup.engines.get(gameId).activePlayers(room.game.state);
    if (active.includes(first)) return { ...setup, room };
  }
  throw new Error(`no seed lets ${first} start`);
}

const sealedChoice = (room) => JSON.parse(room.game.seals.at(-1).text).choice;

describe("botTurns: Rock Paper Scissors seals (CC-225)", () => {
  it("seals the computer's choice in the same save that starts the game, before the person can choose", async () => {
    const { playComputer, rooms } = botRooms();

    const room = await playComputer({ gameId: GAME_IDS.RPS });

    expect(room.status).toBe("playing");
    expect(room.game.seals).toEqual([
      expect.objectContaining({ playerId: ROCKY, sealedAt: 0, revealed: false }),
    ]);
    const view = rooms.viewFor(room, PERSON.id);
    expect(view.fairness).toEqual({
      game: expect.stringMatching(/^[0-9a-f]{16}$/),
      locked: [{ playerId: ROCKY, turn: 0, commitment: room.game.seals[0].commitment }],
      checks: [],
    });
    expect(JSON.stringify(view)).not.toContain(room.game.seals[0].salt);
  });

  it("plans the sealed move for the computer, and nothing else", async () => {
    const { playComputer, botTurns } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS });

    expect(botTurns.nextAction(room)).toEqual({ kind: "move", playerId: ROCKY, key: "m1:0:bot_rocky_easy" });
    expect(botTurns.moveFor(room, ROCKY)).toEqual({ choice: sealedChoice(room) });
  });

  it("refuses any other move from the computer, also after the person chose", async () => {
    const { playComputer, rooms } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS });
    const other = { choice: OTHER_CHOICE[sealedChoice(room)] };
    await rooms.makeMove({
      code: room.code,
      playerId: PERSON.id,
      move: { choice: RPS_CHOICES.ROCK },
      now: 2,
    });

    await expect(rooms.makeMove({ code: room.code, playerId: ROCKY, move: other, now: 3 })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("shows the move and salt once the round is over, and they match the lock shown before", async () => {
    const { playComputer, rooms } = botRooms();
    const started = await playComputer({ gameId: GAME_IDS.RPS });
    const lock = rooms.viewFor(started, PERSON.id).fairness.locked[0].commitment;
    const sealed = { choice: sealedChoice(started) };
    await rooms.makeMove({
      code: started.code,
      playerId: PERSON.id,
      move: { choice: RPS_CHOICES.ROCK },
      now: 2,
    });

    const after = await rooms.makeMove({ code: started.code, playerId: ROCKY, move: sealed, now: 3 });

    const { checks, locked } = rooms.viewFor(after, PERSON.id).fairness;
    expect(checks).toHaveLength(1);
    expect(checks[0].commitment).toBe(lock);
    expect(commitmentOf(checks[0])).toBe(lock);
    expect(JSON.parse(checks[0].text)).toEqual(sealed);
    expect(after.game.state.rounds[0].choices[ROCKY]).toBe(sealed.choice);
    // The next round is sealed at once too, with a fresh lock.
    expect(locked).toHaveLength(after.status === "playing" ? 1 : 0);
  });

  it("keeps the move hidden while only the computer has played it", async () => {
    const { playComputer, rooms } = botRooms();
    const started = await playComputer({ gameId: GAME_IDS.RPS });

    const played = await rooms.makeMove({
      code: started.code,
      playerId: ROCKY,
      move: { choice: sealedChoice(started) },
      now: 2,
    });

    expect(rooms.viewFor(played, PERSON.id).fairness).toEqual({
      game: rooms.viewFor(started, PERSON.id).fairness.game,
      locked: [{ playerId: ROCKY, turn: 0, commitment: started.game.seals[0].commitment }],
      checks: [],
    });
  });

  it("shows a sealed move that was never played once the game is over", async () => {
    const { playComputer, rooms } = botRooms();
    const started = await playComputer({ gameId: GAME_IDS.RPS });

    const { room } = await rooms.leaveRoom({ code: started.code, playerId: PERSON.id, now: 2 });

    expect(rooms.viewFor(room, PERSON.id).fairness.checks).toHaveLength(1);
    expect(rooms.viewFor(room, PERSON.id).fairness.locked).toEqual([]);
  });
});

describe("botTurns: turn based games", () => {
  it("never seals a move when only one player acts at a time", async () => {
    const { room, rooms } = await startedWith(GAME_IDS.TIC_TAC_TOE, PERSON.id);

    expect(room.game).not.toHaveProperty("seals");
    expect(rooms.viewFor(room, PERSON.id)).not.toHaveProperty("fairness");
  });

  it("has nothing to do on the person's turn", async () => {
    const { room, botTurns } = await startedWith(GAME_IDS.TIC_TAC_TOE, PERSON.id);

    expect(botTurns.nextAction(room)).toBe(NO_ACTION);
  });

  it("moves on its own turn, with the same move every time for the same turn", async () => {
    const { room, botTurns, engines } = await startedWith(GAME_IDS.TIC_TAC_TOE, PIP);

    expect(botTurns.nextAction(room)).toEqual({ kind: "move", playerId: PIP, key: `m1:0:${PIP}` });
    const move = botTurns.moveFor(room, PIP);
    expect(botTurns.moveFor(room, PIP)).toEqual(move);
    expect(engines.get(GAME_IDS.TIC_TAC_TOE).validateMove(room.game.state, PIP, move, { now: 1 }).ok).toBe(
      true,
    );
  });

  it("allows any legal move from a computer that sealed nothing, and from people", async () => {
    const { room, botTurns } = await startedWith(GAME_IDS.TIC_TAC_TOE, PIP);

    expect(() => botTurns.checkMove({ room, playerId: PIP, move: { cell: 4 } })).not.toThrow();
    expect(() => botTurns.checkMove({ room, playerId: PERSON.id, move: { cell: 4 } })).not.toThrow();
  });

  it("declines a draw offered on the person's own turn at once, and moves when it is its turn", async () => {
    const { room, rooms, botTurns } = await startedWith(GAME_IDS.CHESS, PERSON.id);

    const offered = await rooms.makeMove({
      code: room.code,
      playerId: PERSON.id,
      move: { type: CHESS_ACTIONS.OFFER_DRAW },
      now: 2,
    });

    expect(botTurns.nextAction(offered)).toEqual({
      kind: "answer",
      playerId: VEE,
      move: { type: CHESS_ACTIONS.DECLINE_DRAW },
      key: `m1:1:${VEE}`,
    });
    const moved = await rooms.makeMove({
      code: room.code,
      playerId: PERSON.id,
      move: { type: CHESS_ACTIONS.MOVE, from: "e2", to: "e4" },
      now: 3,
    });
    expect(botTurns.nextAction(moved)).toEqual(expect.objectContaining({ kind: "move", playerId: VEE }));
  });
});

describe("botTurns: rematches", () => {
  it("accepts a rematch the person asked for, and never asks by itself", async () => {
    const { playComputer, rooms, botTurns } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS, options: { bestOf: 1 } });
    let current = room;
    while (current.status === "playing") {
      const choice = sealedChoice(current);
      await rooms.makeMove({ code: room.code, playerId: ROCKY, move: { choice }, now: 2 });
      current = await rooms.makeMove({
        code: room.code,
        playerId: PERSON.id,
        move: { choice: OTHER_CHOICE[choice] },
        now: 3,
      });
    }

    expect(botTurns.nextAction(current)).toBe(NO_ACTION);
    const asked = await rooms.requestRematch({ code: room.code, playerId: PERSON.id, now: 4 });
    expect(botTurns.nextAction(asked)).toEqual({ kind: "rematch", playerId: ROCKY, key: "m1:rematch" });
  });

  it("names the rematch's seals as another game, so a browser never mixes them up with the last game's", async () => {
    const { playComputer, rooms } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS, options: { bestOf: 1 } });
    const firstGame = rooms.viewFor(room, PERSON.id).fairness;
    let current = room;
    while (current.status === "playing") {
      const choice = sealedChoice(current);
      await rooms.makeMove({ code: room.code, playerId: ROCKY, move: { choice }, now: 2 });
      current = await rooms.makeMove({
        code: room.code,
        playerId: PERSON.id,
        move: { choice: OTHER_CHOICE[choice] },
        now: 3,
      });
    }
    await rooms.requestRematch({ code: room.code, playerId: PERSON.id, now: 4 });

    const rematch = await rooms.requestRematch({ code: room.code, playerId: ROCKY, now: 5 });

    const secondGame = rooms.viewFor(rematch, PERSON.id).fairness;
    expect(secondGame.locked[0].turn).toBe(firstGame.locked[0].turn);
    expect(secondGame.game).not.toBe(firstGame.game);
  });

  it("does nothing in a finished game nobody can play again", async () => {
    const { playComputer, rooms, botTurns } = botRooms();
    const room = await playComputer({ gameId: GAME_IDS.RPS });

    const { room: forfeited } = await rooms.leaveRoom({ code: room.code, playerId: PERSON.id, now: 2 });

    expect(forfeited.rematch.available).toBe(false);
    expect(botTurns.nextAction(forfeited)).toBe(NO_ACTION);
  });

  it("does nothing once it has asked too", () => {
    const { botTurns } = botRooms();
    const room = {
      code: "ROOM22",
      gameId: GAME_IDS.TIC_TAC_TOE,
      status: "finished",
      seats: [
        { playerId: PERSON.id, displayName: "Alice", connected: true },
        { playerId: PIP, displayName: "Pip", connected: true, bot: { character: "pip", level: "easy" } },
      ],
      game: { matchId: "m1", seed: 1, log: [], state: {} },
      rematch: { requestedBy: [PERSON.id, PIP], available: true, declinedBy: "" },
    };

    expect(botTurns.nextAction(room)).toBe(NO_ACTION);
  });
});

describe("botTurns: rooms without a computer player, or without a game", () => {
  const plain = {
    code: "ROOM22",
    gameId: GAME_IDS.RPS,
    status: "waiting",
    seats: [{ playerId: PERSON.id, displayName: "Alice", connected: true }],
  };

  it("leaves them as they are", () => {
    const { botTurns } = botRooms();
    const withBot = {
      ...plain,
      seats: [...plain.seats, { playerId: ROCKY, displayName: "Rocky", connected: true, bot: {} }],
    };

    expect(botTurns.settle(plain)).toBe(plain);
    expect(botTurns.settle(withBot)).toBe(withBot);
    expect(botTurns.nextAction(plain)).toBe(NO_ACTION);
    expect(botTurns.nextAction(withBot)).toBe(NO_ACTION);
    expect(botTurns.fairness(plain)).toEqual({ game: "", locked: [], checks: [] });
  });

  it("has rules that change nothing for a server without computer players", () => {
    expect(NO_BOT_TURNS.settle(plain)).toBe(plain);
    expect(NO_BOT_TURNS.checkMove({ room: plain, playerId: PERSON.id, move: {} })).toBeUndefined();
    expect(NO_BOT_TURNS.fairness(plain)).toEqual({ game: "", locked: [], checks: [] });
  });

  it("needs its bots, engines and seal maker", async () => {
    const { createBotTurns } = await import("./botTurns.js");
    const { bots, engines } = botRooms();

    expect(() => createBotTurns({ engines, sealMaker: {} })).toThrow(TypeError);
    expect(() => createBotTurns({ bots, sealMaker: {} })).toThrow(TypeError);
    expect(() => createBotTurns({ bots, engines })).toThrow(TypeError);
  });
});
