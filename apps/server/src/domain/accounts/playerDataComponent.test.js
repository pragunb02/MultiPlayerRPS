import { describe, expect, it, vi } from "vitest";
import { createAccountDeletionAccessor } from "../../data/accountDeletionAccessor.js";
import { createInMemoryAccountDeletionDao } from "../../testing/inMemoryAccountDeletionDao.js";
import { ValidationError } from "../../utils/errors.js";
import { MATCH_RETRY_POLICY, delayAfter } from "../matches/matchOutboxComponent.js";
import {
  createPlayerDataComponent,
  DELETION_RECORD_KEPT_MS,
  SWEEP_AGAIN_AFTER_MS,
  SWEEP_FOR_MS,
} from "./playerDataComponent.js";

const NOW = Date.UTC(2026, 9, 18, 10);
const PLAYER = "user_0123456789abcdef01234567";
const ACCOUNT = Object.freeze({
  username: "Riya",
  email: "riya@example.com",
  createdAt: NOW - 1000,
  birthYear: 2001,
});

function setup({ participants, password = "right" } = {}) {
  const calls = [];
  const accounts = {
    confirmPassword: vi.fn(async ({ password: given }) => {
      if (given !== password) {
        throw new ValidationError("That is not your password", { details: { field: "password" } });
      }
      return ACCOUNT;
    }),
    close: vi.fn(async () => {
      calls.push("account");
      return { closed: true };
    }),
    profileOf: vi.fn(async () => ({ ageGroup: "adult" })),
  };
  const fake = (name, exported) => ({
    name,
    erasePlayer: vi.fn(async () => {
      calls.push(name);
      return { erased: { [name]: 1 } };
    }),
    ...(exported !== undefined && { exportPlayer: vi.fn(async () => exported) }),
  });
  const list = participants ?? [
    fake("rooms"),
    fake("matches", [{ matchId: "m1" }]),
    fake("progress", { xp: 30 }),
  ];
  const deletions = createAccountDeletionAccessor({ accountDeletionDao: createInMemoryAccountDeletionDao() });
  const component = createPlayerDataComponent({
    accountComponent: accounts,
    accountDeletionAccessor: deletions,
    participants: list,
  });
  return { component, accounts, calls, deletions, participants: list };
}

describe("playerDataComponent.deleteAccount (CC-035)", () => {
  it("checks the password, records the deletion, closes the account, then erases every store in order", async () => {
    const { component, calls, deletions } = setup();

    const result = await component.deleteAccount({ playerId: PLAYER, password: "right", now: NOW });

    expect(calls).toEqual(["account", "rooms", "matches", "progress"]);
    expect(result).toEqual({ erased: { rooms: 1, matches: 1, progress: 1 } });
    expect(await deletions.listDue({ now: NOW + SWEEP_AGAIN_AFTER_MS, limit: 5 })).toEqual([
      { playerId: PLAYER, requestedAt: NOW },
    ]);
  });

  it("changes nothing when the password is wrong", async () => {
    const { component, calls, deletions } = setup();

    await expect(component.deleteAccount({ playerId: PLAYER, password: "wrong", now: NOW })).rejects.toThrow(
      ValidationError,
    );

    expect(calls).toEqual([]);
    expect(await deletions.listDue({ now: NOW + DELETION_RECORD_KEPT_MS, limit: 5 })).toEqual([]);
  });

  it("keeps the record for a later sweep when a store fails, so the deletion still finishes", async () => {
    const failing = { name: "matches", erasePlayer: vi.fn().mockRejectedValue(new Error("database down")) };
    const { component, deletions } = setup({ participants: [failing] });

    await expect(component.deleteAccount({ playerId: PLAYER, password: "right", now: NOW })).rejects.toThrow(
      "database down",
    );

    expect(await deletions.listDue({ now: NOW + SWEEP_AGAIN_AFTER_MS, limit: 5 })).toHaveLength(1);
  });

  it("fails fast at construction when a participant cannot erase", () => {
    expect(() =>
      createPlayerDataComponent({
        accountComponent: {},
        accountDeletionAccessor: {},
        participants: [{ name: "broken" }],
      }),
    ).toThrow(TypeError);
  });
});

describe("playerDataComponent.sweepDue (CC-035)", () => {
  it("erases every due deletion again when it is due, and reports what it did", async () => {
    const { component, calls } = setup();
    await component.deleteAccount({ playerId: PLAYER, password: "right", now: NOW });
    calls.length = 0;

    expect(await component.sweepDue({ now: NOW + SWEEP_AGAIN_AFTER_MS - 1 })).toEqual({
      completed: [],
      failed: [],
    });
    expect(await component.sweepDue({ now: NOW + SWEEP_AGAIN_AFTER_MS })).toEqual({
      completed: [PLAYER],
      failed: [],
    });
    expect(calls).toEqual(["account", "rooms", "matches", "progress"]);
    expect(await component.sweepDue({ now: NOW + 2 * SWEEP_AGAIN_AFTER_MS - 1 })).toEqual({
      completed: [],
      failed: [],
    });
  });

  it("reports a sweep that failed and tries it again next time", async () => {
    let fail = true;
    const flaky = {
      name: "matches",
      erasePlayer: vi.fn(async () => {
        if (fail) throw new Error("database down");
        return { erased: {} };
      }),
    };
    const { component, deletions } = setup({ participants: [flaky] });
    await deletions.record({
      playerId: PLAYER,
      requestedAt: NOW,
      sweepAgainAt: NOW,
      expiresAt: NOW + DELETION_RECORD_KEPT_MS,
    });

    const first = await component.sweepDue({ now: NOW });
    fail = false;
    const second = await component.sweepDue({ now: NOW });

    expect(first).toEqual({ completed: [], failed: [{ playerId: PLAYER, error: expect.any(Error) }] });
    expect(second).toEqual({ completed: [PLAYER], failed: [] });
  });
});

describe("playerDataComponent.exportFor (CC-035)", () => {
  it("checks the password and gathers the account and every store that exports", async () => {
    const { component, participants } = setup();

    const exported = await component.exportFor({ playerId: PLAYER, password: "right", now: NOW });

    expect(exported).toEqual({
      exportedAt: new Date(NOW).toISOString(),
      account: {
        username: "Riya",
        email: "riya@example.com",
        createdAt: new Date(NOW - 1000).toISOString(),
        birthYear: 2001,
        ageGroup: "adult",
      },
      matches: [{ matchId: "m1" }],
      progress: { xp: 30 },
    });
    expect(participants[0].erasePlayer).not.toHaveBeenCalled();
  });

  it("leaves the birth year out when it was never stated", async () => {
    const { component, accounts } = setup();
    accounts.confirmPassword.mockResolvedValueOnce({
      username: "Riya",
      email: "r@example.com",
      createdAt: NOW,
    });
    accounts.profileOf.mockResolvedValueOnce({ ageGroup: "unknown" });

    const { account } = await component.exportFor({ playerId: PLAYER, password: "right", now: NOW });

    expect(account).toEqual({
      username: "Riya",
      email: "r@example.com",
      createdAt: new Date(NOW).toISOString(),
      ageGroup: "unknown",
    });
  });

  it("refuses a wrong password", async () => {
    const { component } = setup();

    await expect(component.exportFor({ playerId: PLAYER, password: "wrong", now: NOW })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("playerDataComponent closing and erasing apart (CC-035)", () => {
  it("closes the account first, so the caller can cut the player's sockets before the stores are erased", async () => {
    const { component, calls } = setup();

    await component.closeAccount({ playerId: PLAYER, password: "right", now: NOW });
    expect(calls).toEqual(["account"]);
    const { erased } = await component.eraseAccount({ playerId: PLAYER, now: NOW });

    expect(calls).toEqual(["account", "rooms", "matches", "progress"]);
    expect(erased).toEqual({ rooms: 1, matches: 1, progress: 1 });
  });

  it("refuses to close with a wrong password, and records nothing", async () => {
    const { component, calls, deletions } = setup();

    await expect(component.closeAccount({ playerId: PLAYER, password: "wrong", now: NOW })).rejects.toThrow(
      ValidationError,
    );

    expect(calls).toEqual([]);
    expect(await deletions.listDue({ now: NOW + DELETION_RECORD_KEPT_MS, limit: 5 })).toEqual([]);
  });

  it("sweeps a deletion again every few minutes until the match pipeline's retries are surely over", async () => {
    const { component, calls } = setup();
    await component.deleteAccount({ playerId: PLAYER, password: "right", now: NOW });
    let swept = 0;
    for (let at = NOW; at <= NOW + SWEEP_FOR_MS + 2 * SWEEP_AGAIN_AFTER_MS; at += SWEEP_AGAIN_AFTER_MS) {
      swept += (await component.sweepDue({ now: at })).completed.length;
    }

    expect(swept).toBe(SWEEP_FOR_MS / SWEEP_AGAIN_AFTER_MS);
    expect(calls.filter((name) => name === "account")).toHaveLength(swept + 1);
  });

  it("keeps sweeping longer than every retry of the match pipeline together", () => {
    let total = 0;
    for (let attempt = 1; attempt < MATCH_RETRY_POLICY.maxAttempts; attempt++) {
      total += delayAfter(attempt, MATCH_RETRY_POLICY);
    }

    expect(SWEEP_FOR_MS).toBeGreaterThan(total + SWEEP_AGAIN_AFTER_MS);
  });
});
