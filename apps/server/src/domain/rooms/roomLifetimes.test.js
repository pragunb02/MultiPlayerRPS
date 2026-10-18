import { describe, expect, it } from "vitest";
import { lifetimeOf, ROOM_LIFETIMES, roomLifetimes } from "./roomLifetimes.js";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const seats = (...connected) =>
  connected.map((isConnected, i) => ({ playerId: `p${i}`, displayName: `P${i}`, connected: isConnected }));

describe("room lifetimes", () => {
  it("keeps a finished game open for a rematch for half an hour, a game whose players are away for two hours, and sets the times of requests and presence", () => {
    expect(ROOM_LIFETIMES).toEqual({
      waitingMs: 30 * MINUTE,
      rematchWindowMs: 30 * MINUTE,
      awayMs: 120 * MINUTE,
      idleGameMs: 24 * 60 * MINUTE,
      closedRecordMs: 24 * 60 * MINUTE,
      rematchRequestMs: MINUTE,
      answerKeptMs: 10_000,
      reaskCooldownMs: 10_000,
      awayReleaseMs: 2 * MINUTE,
      reconnectGraceMs: MINUTE,
      firstMoveMs: MINUTE,
    });
    expect(Object.isFrozen(ROOM_LIFETIMES)).toBe(true);
  });

  it("uses the standard lifetimes unless told otherwise", () => {
    expect(roomLifetimes()).toEqual(ROOM_LIFETIMES);
    expect(roomLifetimes({ rematchWindowMs: 5_000 })).toEqual({ ...ROOM_LIFETIMES, rematchWindowMs: 5_000 });
    expect(Object.isFrozen(roomLifetimes({ awayMs: 1 }))).toBe(true);
  });

  it.each([
    [{ rematchMs: 5 }, /Unknown room lifetime: rematchMs/],
    [{ waitingMs: 0 }, /positive/],
    [{ waitingMs: -1 }, /positive/],
    [{ waitingMs: 1.5 }, /positive/],
    [{ waitingMs: "60000" }, /positive/],
  ])("refuses a lifetime that makes no sense (%o)", (overrides, message) => {
    expect(() => roomLifetimes(overrides)).toThrow(TypeError);
    expect(() => roomLifetimes(overrides)).toThrow(message);
  });

  it("ends a waiting room a while after the last thing that happened in it", () => {
    const room = { status: "waiting", seats: seats(true), lastActivityAt: T0 };

    expect(lifetimeOf(room, ROOM_LIFETIMES)).toEqual({ endsAt: T0 + 30 * MINUTE, reason: "expired" });
  });

  it("ends a finished room when the rematch window ends, counted from the end of the game", () => {
    const room = {
      status: "finished",
      seats: seats(true, true),
      finishedAt: T0,
      lastActivityAt: T0 + 9 * MINUTE,
    };

    expect(lifetimeOf(room, ROOM_LIFETIMES)).toEqual({
      endsAt: T0 + 30 * MINUTE,
      reason: "rematch-window-ended",
    });
  });

  it("keeps a game whose players are all away for two hours, long enough to come back from a locked phone", () => {
    const room = { status: "playing", seats: seats(false, false), lastActivityAt: T0 };

    expect(lifetimeOf(room, ROOM_LIFETIMES)).toEqual({ endsAt: T0 + 120 * MINUTE, reason: "abandoned" });
  });

  it("keeps a game a whole day while anyone is still connected, so a forgotten tab cannot keep it forever", () => {
    const room = { status: "playing", seats: seats(true, false), lastActivityAt: T0 };

    expect(lifetimeOf(room, ROOM_LIFETIMES)).toEqual({ endsAt: T0 + 24 * 60 * MINUTE, reason: "abandoned" });
  });

  it("counts only people: a game against the computer whose person is away is kept for two hours (CC-138)", () => {
    const computer = { playerId: "bot_pip_easy", displayName: "Pip", connected: true, bot: {} };
    const room = { status: "playing", seats: [...seats(false), computer], lastActivityAt: T0 };

    expect(lifetimeOf(room, ROOM_LIFETIMES)).toEqual({ endsAt: T0 + 120 * MINUTE, reason: "abandoned" });
  });
});
