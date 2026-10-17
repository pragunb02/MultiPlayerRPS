/**
 * Why a recorded game gave a player no XP, no win, no quest progress and no leaderboard place (CC-095). The game
 * still appears in match history, and the web app tells the player the reason.
 */
export const NOT_COUNTED_REASONS = Object.freeze({
  /** a player never moved, or someone left before every player made two moves */
  ENDED_TOO_SOON: "ended-too-soon",
  /** these two players already played their counted games for today (UTC) */
  OPPONENT_DAILY_LIMIT: "opponent-daily-limit",
  /** this player already played their counted games for this hour (UTC) */
  HOURLY_LIMIT: "hourly-limit",
});
