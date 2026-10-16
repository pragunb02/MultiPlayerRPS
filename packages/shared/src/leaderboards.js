import { GAMES } from "./games.js";

/**
 * Public leaderboards (CC-053). Only accounts are listed, guests never appear on a board. The id is the board's
 * URL segment (`/leaderboards/chess`). The boards for each game are generated from `GAMES`, so a new game gets a
 * board without code changes elsewhere.
 *
 * @typedef {Object} LeaderboardInfo
 * @property {string} id                  stable URL segment, never reused for another board
 * @property {string} name                display name
 * @property {"xp" | "wins"} metric       what the score counts
 * @property {"all" | "week"} period      all time, or the current ISO week (UTC, starting Monday 00:00)
 * @property {string} [gameId]            the game a "wins" board counts
 */

export const LEADERBOARD_METRICS = Object.freeze({ XP: "xp", WINS: "wins" });
export const LEADERBOARD_PERIODS = Object.freeze({ ALL: "all", WEEK: "week" });
/** Why the viewer has no rank on a board (`you.reason`). */
export const LEADERBOARD_UNLISTED = Object.freeze({ GUEST: "guest", UNRANKED: "unranked" });
/** The most entries one board response lists. Your own rank is reported even when it is outside them. */
export const LEADERBOARD_MAX_ENTRIES = 50;

/** @type {ReadonlyArray<Readonly<LeaderboardInfo>>} */
export const LEADERBOARDS = Object.freeze(
  [
    { id: "overall", name: "Overall XP", metric: LEADERBOARD_METRICS.XP, period: LEADERBOARD_PERIODS.ALL },
    { id: "weekly", name: "This week", metric: LEADERBOARD_METRICS.XP, period: LEADERBOARD_PERIODS.WEEK },
    ...GAMES.map((game) => ({
      id: game.slug,
      name: game.name,
      metric: LEADERBOARD_METRICS.WINS,
      period: LEADERBOARD_PERIODS.ALL,
      gameId: game.id,
    })),
  ].map((board) => Object.freeze(board)),
);

export const DEFAULT_LEADERBOARD_ID = LEADERBOARDS[0].id;

/**
 * @param {string} id
 * @returns {Readonly<LeaderboardInfo> | undefined}
 */
export function getLeaderboard(id) {
  return LEADERBOARDS.find((board) => board.id === id);
}
