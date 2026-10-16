import { ACHIEVEMENT_METRICS, ACHIEVEMENTS, GAMES } from "@classicade/shared";

const WINS_OF = "winsByGame.";
const M = ACHIEVEMENT_METRICS;

/** How each metric is read from a player's stats and progress totals. */
const METRICS = Object.freeze({
  [M.MATCHES_PLAYED]: ({ progress }) => progress.matchesPlayed,
  [M.WINS]: ({ progress }) => progress.wins,
  [M.BEST_WIN_STREAK]: ({ stats }) => stats.winStreak.best,
  [M.BEST_DAILY_STREAK]: ({ stats }) => stats.dailyStreak.best,
  [M.GAMES_WON]: ({ stats }) => GAMES.filter((game) => (stats.winsByGame[game.id] ?? 0) >= 1).length,
  [M.CHECKMATE_WINS]: ({ stats }) => stats.checkmateWins,
  [M.XP]: ({ progress }) => progress.xp,
  [M.QUESTS_COMPLETED]: ({ stats }) => stats.questsCompleted,
});

/**
 * @param {string} metric
 * @param {{ stats: Readonly<import("./stats.js").PlayerStats>, progress: { xp: number, matchesPlayed: number, wins: number } }} sources
 * @returns {number}
 */
export function metricValue(metric, sources) {
  if (metric.startsWith(WINS_OF)) {
    return sources.stats.winsByGame[metric.slice(WINS_OF.length)] ?? 0;
  }
  const read = METRICS[metric];
  if (read === undefined) {
    throw new RangeError(`Unknown achievement metric: ${metric}`);
  }
  return read(sources);
}

/**
 * Where a player stands on every achievement, in catalog order: progress capped at the target, and whether it
 * is earned.
 *
 * @param {Readonly<import("./stats.js").PlayerStats>} stats
 * @param {{ xp: number, matchesPlayed: number, wins: number }} progress
 * @param {ReadonlyArray<Readonly<import("@classicade/shared/src/achievements.js").AchievementInfo>>} [catalog]
 */
export function achievementStanding(stats, progress, catalog = ACHIEVEMENTS) {
  return catalog.map((achievement) => {
    const value = metricValue(achievement.metric, { stats, progress });
    return Object.freeze({
      achievement,
      current: Math.min(value, achievement.target),
      earned: value >= achievement.target,
    });
  });
}

/**
 * The ids of every achievement a player has earned (pure; unlocking and "only once" happen in the component).
 *
 * @param {Readonly<import("./stats.js").PlayerStats>} stats
 * @param {{ xp: number, matchesPlayed: number, wins: number }} progress
 * @returns {string[]}
 */
export function evaluateAchievements(stats, progress) {
  return achievementStanding(stats, progress)
    .filter(({ earned }) => earned)
    .map(({ achievement }) => achievement.id);
}
