import { describe, expect, it } from "vitest";
import { createInMemoryMatchDao } from "../testing/inMemoryMatchDao.js";
import { NotFoundError } from "../utils/errors.js";
import { createMatchAccessor } from "./matchAccessor.js";

const T0 = 1_760_000_000_000;
const match = (overrides = {}) => ({
  matchId: "00000000-0000-4000-8000-000000000001",
  roomCode: "ROOM22",
  gameId: "rps",
  options: { bestOf: 1 },
  seed: 7,
  players: [
    { playerId: "guest_a", displayName: "Alice" },
    { playerId: "guest_b", displayName: "Bob" },
  ],
  log: [{ kind: "move", playerId: "guest_a", move: { choice: "rock" }, at: T0 }],
  result: { result: "win", winners: ["guest_a"], reason: "best-of-1" },
  startedAt: T0,
  endedAt: T0 + 5_000,
  ...overrides,
});
const setup = () => createMatchAccessor({ matchDao: createInMemoryMatchDao() });

describe("matchAccessor", () => {
  it("records matches and returns deeply frozen domain models with ms timestamps", async () => {
    const recorded = await setup().record(match());

    expect(recorded).toEqual(match());
    expect(Object.isFrozen(recorded.players[0])).toBe(true);
    expect(recorded).not.toHaveProperty("schemaVersion");
  });

  it("is idempotent: recording the same match again returns the stored one", async () => {
    const matches = setup();
    await matches.record(match());

    expect(await matches.record(match({ seed: 999 }))).toEqual(match());
  });

  it("translates an unknown id into NotFoundError", async () => {
    await expect(setup().getById("00000000-0000-4000-8000-000000000404")).rejects.toThrow(NotFoundError);
  });

  it("pages with ms timestamps", async () => {
    const matches = setup();
    await matches.record(match({ matchId: "00000000-0000-4000-8000-000000000001", endedAt: T0 + 1 }));
    await matches.record(match({ matchId: "00000000-0000-4000-8000-000000000002", endedAt: T0 + 2 }));

    const page = await matches.listForPlayer("guest_a", { limit: 5, before: T0 + 2 });

    expect(page.map((m) => m.endedAt)).toEqual([T0 + 1]);
  });

  it("counts a player's wins of one game", async () => {
    const matches = setup();
    await matches.record(match());
    await matches.record(match({ matchId: "00000000-0000-4000-8000-000000000002", gameId: "chess" }));

    expect(await matches.countWins({ playerId: "guest_a", gameId: "rps" })).toBe(1);
    expect(await matches.countWins({ playerId: "guest_b", gameId: "rps" })).toBe(0);
  });

  it("passes unexpected storage failures through unchanged", async () => {
    const failure = new Error("disk on fire");
    const matches = createMatchAccessor({
      matchDao: {
        insert: async () => {
          throw failure;
        },
        getByMatchId: async () => {
          throw failure;
        },
      },
    });

    await expect(matches.record(match())).rejects.toBe(failure);
    await expect(matches.getById("x")).rejects.toBe(failure);
  });
});
