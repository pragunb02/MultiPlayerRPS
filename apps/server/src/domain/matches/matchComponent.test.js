import { describe, expect, it } from "vitest";
import { createMatchAccessor } from "../../data/matchAccessor.js";
import { createInMemoryMatchDao } from "../../testing/inMemoryMatchDao.js";
import { NotFoundError } from "../../utils/errors.js";
import { createMatchComponent } from "./matchComponent.js";

const T0 = 1_760_000_000_000;
const room = (overrides = {}) => ({
  code: "ROOM22",
  gameId: "rps",
  options: { bestOf: 1 },
  status: "finished",
  hostId: "guest_a",
  seats: [
    { playerId: "guest_a", displayName: "Alice", connected: true },
    { playerId: "guest_b", displayName: "Bob", connected: false },
  ],
  game: {
    matchId: "00000000-0000-4000-8000-000000000001",
    seed: 7,
    startedAt: T0,
    state: { secret: "engine internals" },
    log: [{ kind: "move", playerId: "guest_a", move: { choice: "rock" }, at: T0 + 1 }],
  },
  createdAt: T0 - 1_000,
  lastActivityAt: T0 + 9_000,
  version: 7,
  ...overrides,
});
const WIN_A = { status: "finished", result: "win", winners: ["guest_a"], reason: "best-of-1" };
const DRAW = { status: "finished", result: "draw", winners: [], reason: "agreement" };
const setup = () =>
  createMatchComponent({ matchAccessor: createMatchAccessor({ matchDao: createInMemoryMatchDao() }) });

describe("matchComponent", () => {
  it("records a finished room as a match: players, seed, log, result and timing — not engine state", async () => {
    const matches = setup();

    const match = await matches.recordFinished({ room: room(), outcome: WIN_A });

    expect(match).toEqual({
      matchId: "00000000-0000-4000-8000-000000000001",
      roomCode: "ROOM22",
      gameId: "rps",
      options: { bestOf: 1 },
      seed: 7,
      players: [
        { playerId: "guest_a", displayName: "Alice" },
        { playerId: "guest_b", displayName: "Bob" },
      ],
      log: [{ kind: "move", playerId: "guest_a", move: { choice: "rock" }, at: T0 + 1 }],
      result: { result: "win", winners: ["guest_a"], reason: "best-of-1" },
      startedAt: T0,
      endedAt: T0 + 9_000,
    });
  });

  it.each([
    ["guest_a", WIN_A, "win"],
    ["guest_b", WIN_A, "loss"],
    ["guest_b", DRAW, "draw"],
  ])("tells %s how the match went (%o → %s)", async (playerId, outcome, expected) => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome });

    const [summary] = await matches.listForPlayer({ playerId, limit: 10 });

    expect(summary.outcomeForYou).toBe(expected);
    expect(summary).not.toHaveProperty("log");
  });

  it("gives participants the full record, including the log", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: WIN_A });

    const match = await matches.getForPlayer({ matchId: room().game.matchId, playerId: "guest_b" });

    expect(match.log).toHaveLength(1);
    expect(match.outcomeForYou).toBe("loss");
  });

  it("hides a match from non-participants as 'not found', so ids cannot be probed", async () => {
    const matches = setup();
    await matches.recordFinished({ room: room(), outcome: WIN_A });

    await expect(matches.getForPlayer({ matchId: room().game.matchId, playerId: "guest_x" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("fails fast without an accessor", () => {
    expect(() => createMatchComponent({})).toThrow(TypeError);
  });
});

describe("matchComponent: a guest's history moving to their account (CC-032)", () => {
  const ACCOUNT = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
  const withMatch = (matchId, seats, endedAt = T0 + 9_000) =>
    room({ seats, lastActivityAt: endedAt, game: { ...room().game, matchId } });
  const ALICE = { playerId: "guest_a", displayName: "Alice", connected: true };
  const BOB = { playerId: "guest_b", displayName: "Bob", connected: true };

  it("rewrites the guest's matches as the account's: seats, moves and winners", async () => {
    const matches = setup();
    await matches.recordFinished({ room: withMatch("m1", [ALICE, BOB]), outcome: WIN_A });

    const result = await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });
    const moved = await matches.getForPlayer({ matchId: "m1", playerId: ACCOUNT.id });

    expect(result).toEqual({ moved: { matches: 1 } });
    expect(moved.players).toEqual([
      { playerId: ACCOUNT.id, displayName: "Riya" },
      { playerId: "guest_b", displayName: "Bob" },
    ]);
    expect(moved.log[0].playerId).toBe(ACCOUNT.id);
    expect(moved.result.winners).toEqual([ACCOUNT.id]);
    expect(moved.outcomeForYou).toBe("win");
    expect(await matches.listForPlayer({ playerId: "guest_a", limit: 10 })).toEqual([]);
  });

  it("leaves a match the guest played against the same account as it is", async () => {
    const matches = setup();
    const accountSeat = { playerId: ACCOUNT.id, displayName: "Riya", connected: true };
    await matches.recordFinished({ room: withMatch("m-self", [ALICE, accountSeat]), outcome: WIN_A });

    const result = await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

    expect(result).toEqual({ moved: { matches: 0 } });
    expect((await matches.getById("m-self")).players[0].playerId).toBe("guest_a");
  });

  it("moves nothing the second time", async () => {
    const matches = setup();
    await matches.recordFinished({ room: withMatch("m1", [ALICE, BOB]), outcome: WIN_A });
    await matches.recordFinished({ room: withMatch("m2", [BOB, ALICE], T0 + 20_000), outcome: WIN_A });
    await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

    const again = await matches.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 });

    expect(again).toEqual({ moved: { matches: 0 } });
    expect(await matches.listForPlayer({ playerId: ACCOUNT.id, limit: 10 })).toHaveLength(2);
  });

  it("counts only the matches it renamed itself when another move got there first", async () => {
    const dao = createInMemoryMatchDao();
    const accessor = createMatchAccessor({ matchDao: dao });
    const racing = createMatchComponent({
      matchAccessor: {
        ...accessor,
        // Another run renames the match between the listing and the write.
        listExcluding: async (...args) => {
          const listed = await accessor.listExcluding(...args);
          await createMatchComponent({ matchAccessor: accessor }).transferPlayer({
            from: "guest_a",
            to: ACCOUNT,
            now: T0,
          });
          return listed;
        },
      },
    });
    await racing.recordFinished({ room: withMatch("m1", [ALICE, BOB]), outcome: WIN_A });

    expect(await racing.transferPlayer({ from: "guest_a", to: ACCOUNT, now: T0 })).toEqual({
      moved: { matches: 0 },
    });
  });
});
