import { LEADERBOARD_METRICS, LEADERBOARD_PERIODS, LEADERBOARDS } from "@classicade/shared";
import { isoWeek } from "./isoWeek.js";

/** Weekly entries are kept this long after their week ends (then MongoDB removes them). */
export const WEEKLY_RETENTION_MS = 28 * 24 * 60 * 60 * 1000;

/** Storage keys: one XP board (all time and per week) and one wins board per game. */
export const XP_BOARD = "xp";
export const winsBoard = (gameId) => `wins:${gameId}`;

/**
 * Where a public board's entries are stored, and which period is current.
 *
 * @param {Readonly<import("@classicade/shared").LeaderboardInfo>} info
 * @param {number} now
 * @returns {{ board: string, period: string, resetsAt?: number }}
 */
export function storageFor(info, now) {
  const board = info.metric === LEADERBOARD_METRICS.XP ? XP_BOARD : winsBoard(info.gameId);
  if (info.period === LEADERBOARD_PERIODS.WEEK) {
    const week = isoWeek(now);
    return { board, period: week.id, resetsAt: week.endsAt };
  }
  return { board, period: LEADERBOARD_PERIODS.ALL };
}

/**
 * The weekly XP period a moment falls in, and when its entries may be removed.
 *
 * @param {number} at
 */
export function weekOf(at) {
  const week = isoWeek(at);
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
