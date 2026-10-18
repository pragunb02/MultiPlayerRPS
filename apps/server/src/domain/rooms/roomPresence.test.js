import { describe, expect, it } from "vitest";
import { PRESENCE, REQUEST_STATES, ROOM_STATUS } from "@classicade/shared";
import { ROOM_LIFETIMES } from "./roomLifetimes.js";
import {
  graceUntil,
  nextDue,
  presenceOf,
  presenceSince,
  releaseAt,
  turnLimit,
  withPresence,
  withTurnCredit,
} from "./roomPresence.js";

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const lifetimes = ROOM_LIFETIMES;
const here = (playerId) => ({ playerId, displayName: playerId, connected: true, away: false, since: T0 });
const room = (overrides = {}) => ({
  status: ROOM_STATUS.PLAYING,
  seats: [here("alice"), here("bob")],
  lastActivityAt: T0,
  finishedAt: 0,
  game: { startedAt: T0, log: [], state: {} },
  requests: [],
  ...overrides,
});
const turnOf = (due, extra = {}) => ({ activePlayers: () => due, ...extra });

describe("room presence (CC-158, CC-207)", () => {
  it("reads a seat as here, away or offline, and older seats by whether they are connected", () => {
    expect(presenceOf({ connected: true })).toBe(PRESENCE.HERE);
    expect(presenceOf({ connected: false, away: true })).toBe(PRESENCE.AWAY);
    expect(presenceOf({ connected: false, away: false })).toBe(PRESENCE.OFFLINE);
    expect(presenceOf({ connected: false })).toBe(PRESENCE.OFFLINE);
    expect(presenceSince(room(), { connected: false })).toBe(T0);
    expect(presenceSince(room(), { connected: false, since: T0 + 5 })).toBe(T0 + 5);
  });

  it("sets one player's presence with the time it changed, and keeps the same room when nothing changes", () => {
    const before = room();
    const after = withPresence(before, { playerId: "bob", presence: PRESENCE.AWAY, now: T0 + 7 });

    expect(after.seats[1]).toEqual({ ...here("bob"), connected: false, away: true, since: T0 + 7 });
    expect(after.seats[0]).toBe(before.seats[0]);
    expect(after.lastActivityAt).toBe(T0 + 7);
    expect(withPresence(before, { playerId: "bob", presence: PRESENCE.HERE, now: T0 + 7 })).toBe(before);
    expect(withPresence(before, { playerId: "carol", presence: PRESENCE.AWAY, now: T0 + 7 })).toBe(before);
  });

  it("gives an offline player a minute of grace in a game still on, and none away or after the game", () => {
    const offline = { ...here("bob"), connected: false, since: T0 + 10 };
    const away = { ...offline, away: true };

    expect(graceUntil(room(), offline, lifetimes)).toBe(T0 + 10 + 60_000);
    expect(graceUntil(room(), away, lifetimes)).toBe(0);
    expect(graceUntil(room({ status: ROOM_STATUS.FINISHED }), offline, lifetimes)).toBe(0);
  });

  it("gives up the seat of a finished room two minutes after the player left it, or after the game ended", () => {
    const finished = room({ status: ROOM_STATUS.FINISHED, finishedAt: T0 + 100 });
    const away = (since) => ({ ...here("bob"), connected: false, away: true, since });

    expect(releaseAt(finished, away(T0 + 500), lifetimes)).toBe(T0 + 500 + 120_000);
    expect(releaseAt(finished, away(T0), lifetimes)).toBe(T0 + 100 + 120_000);
    expect(releaseAt(finished, here("bob"), lifetimes)).toBe(0);
    expect(releaseAt(room(), away(T0), lifetimes)).toBe(0);
  });
});

describe("room idle limits (CC-036)", () => {
  it("gives a first move a minute from the start of the game", () => {
    expect(turnLimit(room(), { engine: turnOf(["alice"]), lifetimes })).toEqual({
      endsAt: T0 + 60_000,
      firstMove: true,
      due: ["alice"],
    });
  });

  it("uses the game's own limit once everyone due has moved, counted from the last thing that happened", () => {
    const moved = room({
      game: {
        startedAt: T0,
        state: {},
        log: [
          { kind: "move", playerId: "alice", at: T0 + 1_000 },
          { kind: "move", playerId: "bob", at: T0 + 2_000 },
        ],
      },
    });

    expect(turnLimit(moved, { engine: turnOf(["alice"], { turnLimitMs: 30_000 }), lifetimes }).endsAt).toBe(
      T0 + 32_000,
    );
    expect(turnLimit(moved, { engine: turnOf(["alice"]), lifetimes })).toEqual({
      endsAt: 0,
      firstMove: false,
      due: ["alice"],
    });
  });

  // PR #67 review: the limit ran on through a server restart and while a player was reconnecting.
  describe("over a restart and reconnects", () => {
    const timed = turnOf(["alice"], { turnLimitMs: 30_000 });
    const offline = (playerId, since) => ({ ...here(playerId), connected: false, since });
    /** Alice due to move since Bob moved at T0 + 2s, both having moved once. */
    const aliceToMove = (overrides = {}) =>
      room({
        game: {
          startedAt: T0,
          state: {},
          log: [
            { kind: "move", playerId: "alice", at: T0 + 1_000 },
            { kind: "move", playerId: "bob", at: T0 + 2_000 },
          ],
          ...overrides.game,
        },
        ...(overrides.seats && { seats: overrides.seats }),
      });

    it("counts the turn again from when the game resumed after a restart", () => {
      const resumed = aliceToMove({ game: { resumedAt: T0 + 600_000 } });

      expect(turnLimit(resumed, { engine: timed, lifetimes }).endsAt).toBe(T0 + 630_000);
    });

    it("holds the limit of a due player who is offline until their reconnect grace could be used up", () => {
      const away = aliceToMove({ seats: [offline("alice", T0 + 10_000), here("bob")] });

      expect(turnLimit(away, { engine: timed, lifetimes }).endsAt).toBe(
        T0 + 32_000 + lifetimes.reconnectGraceMs,
      );
    });

    it("gives a due player back the time they were offline during their turn, at most the reconnect grace", () => {
      const back = (offlineSince, backAt) => {
        const before = aliceToMove({ seats: [offline("alice", offlineSince), here("bob")] });
        const after = withPresence(before, { playerId: "alice", presence: PRESENCE.HERE, now: backAt });
        return withTurnCredit(before, after, { playerId: "alice", now: backAt, engine: timed, lifetimes });
      };

      expect(turnLimit(back(T0 + 20_000, T0 + 40_000), { engine: timed, lifetimes }).endsAt).toBe(
        T0 + 52_000,
      );
      // Time offline before the turn started is not the turn's.
      expect(turnLimit(back(T0 - 5_000, T0 + 12_000), { engine: timed, lifetimes }).endsAt).toBe(T0 + 42_000);
      expect(turnLimit(back(T0 + 20_000, T0 + 500_000), { engine: timed, lifetimes }).endsAt).toBe(
        T0 + 32_000 + lifetimes.reconnectGraceMs,
      );
    });

    it("adds up the time back over several reconnects in one turn, never past the reconnect grace", () => {
      const before = aliceToMove({ seats: [offline("alice", T0 + 10_000), here("bob")] });
      const once = withTurnCredit(
        before,
        withPresence(before, { playerId: "alice", presence: PRESENCE.HERE, now: T0 + 50_000 }),
        { playerId: "alice", now: T0 + 50_000, engine: timed, lifetimes },
      );
      const gone = withPresence(once, { playerId: "alice", presence: PRESENCE.OFFLINE, now: T0 + 55_000 });
      const twice = withTurnCredit(
        gone,
        withPresence(gone, { playerId: "alice", presence: PRESENCE.HERE, now: T0 + 85_000 }),
        { playerId: "alice", now: T0 + 85_000, engine: timed, lifetimes },
      );

      expect(turnLimit(once, { engine: timed, lifetimes }).endsAt).toBe(T0 + 72_000);
      expect(turnLimit(twice, { engine: timed, lifetimes }).endsAt).toBe(
        T0 + 32_000 + lifetimes.reconnectGraceMs,
      );
    });

    it("gives nothing back to a player not due, to one who was not offline, or once the turn has passed", () => {
      const before = aliceToMove({ seats: [here("alice"), offline("bob", T0 + 10_000)] });
      const bobBack = withPresence(before, { playerId: "bob", presence: PRESENCE.HERE, now: T0 + 20_000 });
      const awayBack = aliceToMove({
        seats: [{ ...here("alice"), connected: false, away: true }, here("bob")],
      });

      expect(
        withTurnCredit(before, bobBack, { playerId: "bob", now: T0 + 20_000, engine: timed, lifetimes }),
      ).toBe(bobBack);
      const hereAgain = withPresence(awayBack, {
        playerId: "alice",
        presence: PRESENCE.HERE,
        now: T0 + 9_000,
      });
      expect(
        withTurnCredit(awayBack, hereAgain, { playerId: "alice", now: T0 + 9_000, engine: timed, lifetimes }),
      ).toBe(hereAgain);
      const credited = {
        ...aliceToMove(),
        game: { ...aliceToMove().game, turnCredit: { entries: 1, ms: 9_000 } },
      };
      expect(turnLimit(credited, { engine: timed, lifetimes }).endsAt).toBe(T0 + 32_000);
    });
  });

  it("runs no limit when nobody is due or the game is not on", () => {
    expect(turnLimit(room(), { engine: turnOf([]), lifetimes }).endsAt).toBe(0);
    expect(
      turnLimit(room({ status: ROOM_STATUS.FINISHED }), { engine: turnOf(["alice"]), lifetimes }).endsAt,
    ).toBe(0);
  });

  it("is due at the earliest of the game's deadline, the idle limit, a request expiring and a seat release", () => {
    const request = { state: REQUEST_STATES.OPEN, expiresAt: T0 + 30_000 };
    const engine = turnOf(["alice"], { deadline: () => T0 + 45_000 });

    expect(nextDue(room(), { engine, lifetimes })).toBe(T0 + 45_000);
    expect(nextDue(room({ requests: [request] }), { engine, lifetimes })).toBe(T0 + 30_000);
    expect(nextDue(room({ status: ROOM_STATUS.FINISHED, finishedAt: T0 }), { engine, lifetimes })).toBe(0);
    expect(
      nextDue(
        room({
          status: ROOM_STATUS.FINISHED,
          finishedAt: T0,
          seats: [here("alice"), { ...here("bob"), connected: false, away: true }],
        }),
        { engine, lifetimes },
      ),
    ).toBe(T0 + 120_000);
  });
});
