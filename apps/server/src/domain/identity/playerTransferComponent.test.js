import { describe, expect, it, vi } from "vitest";
import { createPlayerTransferAccessor } from "../../data/playerTransferAccessor.js";
import { createInMemoryPlayerTransferDao } from "../../testing/inMemoryPlayerTransferDao.js";
import { ConflictError } from "../../utils/errors.js";
import { createPlayerTransferComponent, RESUME_AFTER_MS } from "./playerTransferComponent.js";

const T0 = Date.UTC(2026, 9, 16, 12);
const ACCOUNT = Object.freeze({ kind: "user", id: "user_0123456789abcdef01234567", displayName: "Riya" });
const OTHER_ACCOUNT = Object.freeze({ kind: "user", id: "user_ffffffffffffffffffffffff", displayName: "Bo" });

/** A participant that records calls and moves `moved` the first time for each guest, nothing after. */
function fakeParticipant(name, moved, calls) {
  const done = new Set();
  return {
    name,
    transferPlayer: vi.fn(async ({ from }) => {
      calls.push(name);
      if (done.has(from)) return { moved: {} };
      done.add(from);
      return { moved };
    }),
  };
}

function setup({ participants, matches } = {}) {
  const calls = [];
  const accessor = createPlayerTransferAccessor({ playerTransferDao: createInMemoryPlayerTransferDao() });
  const list = participants ?? [
    fakeParticipant("matches", { matches: 2 }, calls),
    fakeParticipant("progress", { xp: 40, matchesPlayed: 2, wins: 1 }, calls),
  ];
  const fakeMatches = matches ?? {
    transferPlayer: vi.fn(async () => ({ moved: { matches: 1 } })),
    getById: vi.fn(),
  };
  const component = createPlayerTransferComponent({
    playerTransferAccessor: accessor,
    participants: list,
    matches: fakeMatches,
  });
  return { component, accessor, calls, participants: list, matches: fakeMatches };
}

describe("playerTransferComponent.transfer", () => {
  it("runs every participant in order and reports what moved", async () => {
    const { component, calls, accessor } = setup();

    const result = await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 });

    expect(calls).toEqual(["matches", "progress"]);
    expect(result).toEqual({ carriedOver: { xp: 40, matchesPlayed: 2, matches: 2 } });
    expect((await accessor.start({ from: "guest_a", to: ACCOUNT, at: T0 })).transfer).toEqual(
      expect.objectContaining({ status: "done", completedAt: T0, carriedOver: result.carriedOver }),
    );
  });

  it("moves nothing more when the same transfer is asked for again", async () => {
    const { component, calls } = setup();
    await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 });

    const again = await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 + 1 });

    expect(again).toEqual({});
    expect(calls).toEqual(["matches", "progress"]);
  });

  it("says nothing moved for a guest who had nothing yet", async () => {
    const calls = [];
    const { component } = setup({ participants: [fakeParticipant("matches", { matches: 0 }, calls)] });

    expect(await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 })).toEqual({});
  });

  it("counts zero for totals no participant reported", async () => {
    const calls = [];
    const { component } = setup({ participants: [fakeParticipant("progress", { xp: 15 }, calls)] });

    expect(await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 })).toEqual({
      carriedOver: { xp: 15, matchesPlayed: 0, matches: 0 },
    });
  });

  it("refuses to move a guest to a second account", async () => {
    const { component } = setup();
    await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 });

    await expect(component.transfer({ from: "guest_a", to: OTHER_ACCOUNT, now: T0 })).rejects.toThrow(
      ConflictError,
    );
  });

  it("leaves the transfer pending when a participant fails, and a second attempt finishes it", async () => {
    const calls = [];
    const flaky = fakeParticipant("progress", { xp: 40, matchesPlayed: 2 }, calls);
    flaky.transferPlayer.mockRejectedValueOnce(new Error("database down"));
    const { component, accessor } = setup({
      participants: [fakeParticipant("matches", { matches: 2 }, calls), flaky],
    });

    await expect(component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 })).rejects.toThrow(
      "database down",
    );
    expect((await accessor.start({ from: "guest_a", to: ACCOUNT, at: T0 })).transfer.status).toBe("pending");

    const retried = await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 + 1 });

    expect(retried).toEqual({ carriedOver: { xp: 40, matchesPlayed: 2, matches: 0 } });
  });

  it("fails fast on a participant without transferPlayer", () => {
    expect(() =>
      createPlayerTransferComponent({
        playerTransferAccessor: {},
        participants: [{ name: "broken" }],
        matches: {},
      }),
    ).toThrow("broken.transferPlayer must be a function");
    expect(() => createPlayerTransferComponent({ playerTransferAccessor: {}, participants: [] })).toThrow(
      TypeError,
    );
  });
});

describe("playerTransferComponent.resumePending", () => {
  it("finishes transfers interrupted more than 30 s ago and leaves recent ones alone", async () => {
    const calls = [];
    const flaky = fakeParticipant("progress", { xp: 40 }, calls);
    flaky.transferPlayer.mockRejectedValueOnce(new Error("crash")).mockRejectedValueOnce(new Error("crash"));
    const { component, accessor } = setup({ participants: [flaky] });
    await component.transfer({ from: "guest_old", to: ACCOUNT, now: T0 }).catch(() => {});
    await component.transfer({ from: "guest_new", to: ACCOUNT, now: T0 + RESUME_AFTER_MS }).catch(() => {});

    const result = await component.resumePending({ now: T0 + RESUME_AFTER_MS + 1 });

    expect(result).toEqual({ completed: ["guest_old"], failed: [] });
    expect((await accessor.start({ from: "guest_old", to: ACCOUNT, at: 0 })).transfer.status).toBe("done");
    expect((await accessor.start({ from: "guest_new", to: ACCOUNT, at: 0 })).transfer.status).toBe("pending");
  });

  it("reports a transfer that fails again, and keeps it pending", async () => {
    const calls = [];
    const broken = fakeParticipant("progress", { xp: 40 }, calls);
    broken.transferPlayer.mockRejectedValue(new Error("still down"));
    const { component } = setup({ participants: [broken] });
    await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 }).catch(() => {});

    const result = await component.resumePending({ now: T0 + RESUME_AFTER_MS + 1 });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual([
      { from: "guest_a", error: expect.objectContaining({ message: "still down" }) },
    ]);
  });
});

describe("playerTransferComponent.follow", () => {
  const match = (players) =>
    Object.freeze({ matchId: "m1", players: players.map((playerId) => ({ playerId })) });

  it("returns a match with no moved players unchanged", async () => {
    const { component, matches } = setup();
    const recorded = match(["guest_x", "guest_y"]);

    expect(await component.follow({ match: recorded, now: T0 })).toBe(recorded);
    expect(matches.transferPlayer).not.toHaveBeenCalled();
  });

  it("moves a match recorded for a guest who has moved, and returns it as stored now", async () => {
    const { component, matches } = setup();
    await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 });
    const renamed = match([ACCOUNT.id, "guest_b"]);
    matches.getById.mockResolvedValue(renamed);

    const followed = await component.follow({ match: match(["guest_a", "guest_b"]), now: T0 + 5 });

    expect(matches.transferPlayer).toHaveBeenCalledWith({ from: "guest_a", to: ACCOUNT, now: T0 + 5 });
    expect(matches.getById).toHaveBeenCalledWith("m1");
    expect(followed).toBe(renamed);
  });

  it("leaves a match the guest played against their own account as it is", async () => {
    const { component, matches } = setup();
    await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 });
    const recorded = match(["guest_a", ACCOUNT.id]);

    expect(await component.follow({ match: recorded, now: T0 })).toBe(recorded);
    expect(matches.transferPlayer).not.toHaveBeenCalled();
  });
});

describe("playerTransferComponent and deleted accounts (CC-035)", () => {
  it("exports the guests that moved into an account without naming the account, and erases them", async () => {
    const { component } = setup();
    await component.transfer({ from: "guest_a", to: ACCOUNT, now: T0 });

    expect(await component.exportPlayer({ playerId: ACCOUNT.id })).toEqual([
      {
        guest: "guest_a",
        status: "done",
        startedAt: new Date(T0).toISOString(),
        completedAt: new Date(T0).toISOString(),
        carriedOver: { xp: 40, matchesPlayed: 2, matches: 2 },
      },
    ]);
    expect(await component.erasePlayer({ playerId: ACCOUNT.id })).toEqual({ erased: { transfers: 1 } });
    expect(await component.exportPlayer({ playerId: ACCOUNT.id })).toEqual([]);
  });

  it("exports a transfer still under way without an end", async () => {
    const accessor = createPlayerTransferAccessor({ playerTransferDao: createInMemoryPlayerTransferDao() });
    const component = createPlayerTransferComponent({
      playerTransferAccessor: accessor,
      participants: [],
      matches: { transferPlayer: vi.fn(), getById: vi.fn() },
    });
    await accessor.start({ from: "guest_b", to: ACCOUNT, at: T0 });

    expect(await component.exportPlayer({ playerId: ACCOUNT.id })).toEqual([
      { guest: "guest_b", status: "pending", startedAt: new Date(T0).toISOString() },
    ]);
  });
});
