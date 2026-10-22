import { CHESS_END_REASONS } from "@classicade/shared";
import { UTC_CALENDAR } from "../playerDays/zoneCalendar.js";
import { nextDailyStreak, nextWinStreak, readDailyStreak } from "./streaks.js";

/**
 * What a player has done, beyond the XP totals that progression keeps: wins and matches per game, checkmates,
 * completed quests and both streaks. Everything but `questsCompleted` can be rebuilt from recorded matches.
 *
 * @typedef {Object} PlayerStats
 * @property {string} playerId
 * @property {Readonly<Record<string, number>>} winsByGame
 * @property {Readonly<Record<string, number>>} matchesByGame
 * @property {number} checkmateWins
 * @property {number} questsCompleted
 * @property {Readonly<import("./streaks.js").WinStreak>} winStreak
 * @property {Readonly<import("./streaks.js").DailyStreak>} dailyStreak
 * @property {ReadonlyArray<string>} mergedFrom   guest ids whose stats were merged in (CC-032)
 */

/**
 * @param {string} playerId
 * @returns {Readonly<PlayerStats>}
 */
export const emptyStats = (playerId) =>
  Object.freeze({
    playerId,
    winsByGame: Object.freeze({}),
    matchesByGame: Object.freeze({}),
    checkmateWins: 0,
    questsCompleted: 0,
    winStreak: Object.freeze({ current: 0, best: 0 }),
    dailyStreak: Object.freeze({ current: 0, best: 0, lastDay: "" }),
    mergedFrom: Object.freeze([]),
  });

const bump = (counts, key) => Object.freeze({ ...counts, [key]: (counts[key] ?? 0) + 1 });

/**
 * One recorded match, from one player's side. The match day is the player's own (CC-146): `calendar` defaults to UTC
 * days, as before. `freezes` and `covered` are the freeze rules of CC-145 (see `nextDailyStreak`). `now` is when the
 * match is applied: an old UTC streak is read as of then, so a match that arrives late never moves it back.
 *
 * @param {Readonly<PlayerStats>} stats
 * @param {{ gameId: string, result: import("./streaks.js").MatchResult, reason: string, endedAt: number,
 *   calendar?: Readonly<import("../playerDays/zoneCalendar.js").PlayerCalendar>, freezes?: boolean, covered?: ReadonlyArray<string>, now?: number }} match
 * @returns {Readonly<PlayerStats>}
 */
export function applyMatchToStats(
  stats,
  { gameId, result, reason, endedAt, calendar = UTC_CALENDAR, freezes = false, covered = [], now = endedAt },
) {
  const won = result === "win";
  const day = calendar.dayOf(endedAt);
  const today = calendar.dayOf(now);
  const daily = readDailyStreak(stats.dailyStreak, { calendar, today: today > day ? today : day });
  return Object.freeze({
    ...stats,
    matchesByGame: bump(stats.matchesByGame, gameId),
    winsByGame: won ? bump(stats.winsByGame, gameId) : stats.winsByGame,
    checkmateWins: stats.checkmateWins + (won && reason === CHESS_END_REASONS.CHECKMATE ? 1 : 0),
    winStreak: nextWinStreak(stats.winStreak, result),
    dailyStreak: nextDailyStreak(daily, { result, day, at: endedAt, freezes, covered }),
  });
}
