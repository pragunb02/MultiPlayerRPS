import { LEADERBOARD_METRICS, LEADERBOARD_PERIODS, LEADERBOARDS } from "@classicade/shared";
import { isoWeek } from "./isoWeek.js";

/** Weekly entries are kept this long after their week ends (then MongoDB removes them). */
export const WEEKLY_RETENTION_MS = 28 * 24 * 60 * 60 * 1000;

/**
 * A guest's rows end this long after the latest game or bonus that wrote them (ADR-060). It is the guest session's
 * rolling lifetime (ADR-030), and a game is a visit, so a guest's row never outlives the session that could still
 * move it to an account. The composition root's tests check the two stay in step.
 */
export const GUEST_ROW_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** Storage keys: one XP board (all time and per week) and one wins board per game. */
export const XP_BOARD = "xp";
export const winsBoard = (gameId) => `wins:${gameId}`;

/**
 * Where a public board's entries are stored, and which period is current.
 *
 * @param {Readonly<import("@classicade/shared").LeaderboardInfo>} info
 * @param {number} now
 * @param {number} [offsetMs]  the week's clock (see isoWeek): 0 is UTC
 * @returns {{ board: string, period: string, resetsAt?: number }}
 */
export function storageFor(info, now, offsetMs = 0) {
  const board = info.metric === LEADERBOARD_METRICS.XP ? XP_BOARD : winsBoard(info.gameId);
  if (info.period === LEADERBOARD_PERIODS.WEEK) {
    const week = isoWeek(now, offsetMs);
    return { board, period: week.id, resetsAt: week.endsAt };
  }
  return { board, period: LEADERBOARD_PERIODS.ALL };
}

/**
 * The weekly XP period a moment falls in, and when its entries may be removed.
 *
 * @param {number} at
 * @param {number} [offsetMs]  the week's clock (see isoWeek): 0 is UTC
 */
export function weekOf(at, offsetMs = 0) {
  const week = isoWeek(at, offsetMs);
  return { period: week.id, startsAt: week.startsAt, expiresAt: week.endsAt + WEEKLY_RETENTION_MS };
}

/**
 * Whether a game has a wins board (every game in the catalog does; a game outside it — a test engine — not).
 *
 * @param {string} gameId
 */
export const hasWinsBoard = (gameId) =>
  LEADERBOARDS.some((info) => info.metric === LEADERBOARD_METRICS.WINS && info.gameId === gameId);

/** Game ids that have a wins board. */
export const gamesWithWinsBoards = () =>
  LEADERBOARDS.filter((info) => info.metric === LEADERBOARD_METRICS.WINS).map((info) => info.gameId);

/**
 * When a player's rows should end after a write at `at`. An account's all time rows never end, so they have no
 * `allTime`. A guest's rows end `GUEST_ROW_LIFETIME_MS` later, and a weekly row never later than its week's own end.
 *
 * @param {{ isGuest: boolean, at: number, offsetMs?: number }} write
 * @returns {Readonly<{ week: number, allTime?: number }>}
 */
export function rowEnds({ isGuest, at, offsetMs = 0 }) {
  const week = weekOf(at, offsetMs).expiresAt;
  if (!isGuest) {
    return Object.freeze({ week });
  }
  const guestEnd = at + GUEST_ROW_LIFETIME_MS;
  return Object.freeze({ allTime: guestEnd, week: Math.min(week, guestEnd) });
}
