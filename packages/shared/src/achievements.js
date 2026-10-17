import { GAME_IDS, GAMES } from "./games.js";
import { xpForLevel } from "./progression.js";

/** How rare an achievement is. The UI colours badges by tier. */
export const ACHIEVEMENT_TIERS = Object.freeze({
  BRONZE: "bronze",
  SILVER: "silver",
  GOLD: "gold",
  PLATINUM: "platinum",
});

/**
 * What an achievement counts. Each metric is a number the server derives from a player's stats and progress,
 * so every achievement can be rebuilt from recorded matches (ADR-013).
 */
export const ACHIEVEMENT_METRICS = Object.freeze({
  MATCHES_PLAYED: "matchesPlayed",
  WINS: "wins",
  BEST_WIN_STREAK: "winStreak.best",
  BEST_DAILY_STREAK: "dailyStreak.best",
  /** how many games of the catalog the player has won at least once */
  GAMES_WON: "gamesWon",
  CHECKMATE_WINS: "checkmateWins",
  XP: "xp",
  QUESTS_COMPLETED: "questsCompleted",
});

/**
 * Wins of one game, as a metric.
 *
 * @param {string} gameId
 */
export const winsOfMetric = (gameId) => `winsByGame.${gameId}`;

/**
 * @typedef {Object} AchievementInfo
 * @property {string} id           stable and stored with every unlock, so it is never reused
 * @property {string} name
 * @property {string} description
 * @property {string} icon         icon name the web app draws (unknown names fall back to a star)
 * @property {string} tier         ACHIEVEMENT_TIERS value
 * @property {string} metric       ACHIEVEMENT_METRICS value (or `winsOfMetric(gameId)`)
 * @property {number} target       unlocked when the metric reaches this
 */

const entry = ([id, name, description, icon, tier, metric, target]) =>
  Object.freeze({ id, name, description, icon, tier, metric, target });
const { BRONZE, SILVER, GOLD, PLATINUM } = ACHIEVEMENT_TIERS;
const M = ACHIEVEMENT_METRICS;

/**
 * The achievement catalog, in display order. Achievements are status only: they award no XP (ADR-013).
 *
 * @type {ReadonlyArray<Readonly<AchievementInfo>>}
 */
export const ACHIEVEMENTS = Object.freeze(
  [
    ["first-match", "First Move", "Finish your first match", "flag", BRONZE, M.MATCHES_PLAYED, 1],
    ["first-win", "First Victory", "Win a match", "trophy", BRONZE, M.WINS, 1],
    ["wins-10", "Rising Star", "Win 10 matches", "star", SILVER, M.WINS, 10],
    ["wins-50", "Champion", "Win 50 matches", "crown", GOLD, M.WINS, 50],
    ["matches-100", "Centurion", "Finish 100 matches", "centurion", GOLD, M.MATCHES_PLAYED, 100],
    ["streak-3", "Hat Trick", "Win 3 matches in a row", "flame", SILVER, M.BEST_WIN_STREAK, 3],
    ["streak-5", "Unstoppable", "Win 5 matches in a row", "flame-double", GOLD, M.BEST_WIN_STREAK, 5],
    ["daily-3", "Habit Forming", "Play on 3 days in a row", "calendar", BRONZE, M.BEST_DAILY_STREAK, 3],
    ["daily-7", "Regular", "Play on 7 days in a row", "calendar-star", GOLD, M.BEST_DAILY_STREAK, 7],
    // Grows with the catalog: a new game raises the bar for everyone.
    ["all-games", "Triple Threat", "Win a match of every game", "triad", SILVER, M.GAMES_WON, GAMES.length],
    [
      "rps-10",
      "Rock Solid",
      "Win 10 Rock Paper Scissors matches",
      "fist",
      SILVER,
      winsOfMetric(GAME_IDS.RPS),
      10,
    ],
    [
      "tictactoe-10",
      "Noughts & Crosses Master",
      "Win 10 Tic Tac Toe matches",
      "grid",
      SILVER,
      winsOfMetric(GAME_IDS.TIC_TAC_TOE),
      10,
    ],
    ["chess-checkmate", "Checkmate!", "Win a chess game by checkmate", "knight", SILVER, M.CHECKMATE_WINS, 1],
    ["level-10", "Veteran", "Reach level 10", "shield", GOLD, M.XP, xpForLevel(10)],
    ["quests-10", "Quest Hunter", "Complete 10 daily quests", "scroll", PLATINUM, M.QUESTS_COMPLETED, 10],
  ].map(entry),
);
