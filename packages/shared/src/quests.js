import { GAME_IDS } from "./games.js";

/** Each day a player gets one quest from each slot, in this order. */
export const QUEST_SLOTS = Object.freeze({ PLAY: "play", WIN: "win", GAME: "game" });

/**
 * What a quest counts in each counted match. A player's own forfeit never counts.
 * 1. `play`: finished matches.
 * 2. `win`: wins.
 * 3. `distinct-games`: different games played.
 * 4. `wins-in-a-row`: wins in a row today. A draw keeps the run going, a loss ends it.
 */
export const QUEST_COUNTS = Object.freeze({
  PLAY: "play",
  WIN: "win",
  DISTINCT_GAMES: "distinct-games",
  WINS_IN_A_ROW: "wins-in-a-row",
});

/** Extra XP for finishing all of the day's quests ("Daily sweep"). */
export const DAILY_SWEEP_BONUS_XP = 30;

/**
 * @typedef {Object} QuestInfo
 * @property {string} id             stable and stored in each day's snapshot, so it is never reused
 * @property {string} slot           QUEST_SLOTS value
 * @property {string} name
 * @property {string} description
 * @property {string} counts         QUEST_COUNTS value
 * @property {string | null} gameId  only matches of this game count. null means any game.
 * @property {number} target
 * @property {number} bonusXp        awarded once, when the quest is completed
 */

const quest = ([slot, id, name, description, counts, gameId, target, bonusXp]) =>
  Object.freeze({ id, slot, name, description, counts, gameId, target, bonusXp });
const { PLAY, WIN, GAME } = QUEST_SLOTS;
const C = QUEST_COUNTS;
const { RPS, TIC_TAC_TOE, CHESS } = GAME_IDS;

/**
 * The daily quest catalog. At most 150 XP a day comes from quests (the richest quest of each slot plus the
 * sweep), so playing more matches cannot earn unlimited quest XP (ADR-013).
 *
 * @type {ReadonlyArray<Readonly<QuestInfo>>}
 */
export const QUESTS = Object.freeze(
  [
    [PLAY, "play-3", "Warm-up", "Finish 3 matches", C.PLAY, null, 3, 20],
    [PLAY, "play-5", "Marathon", "Finish 5 matches", C.PLAY, null, 5, 30],
    [PLAY, "variety-2", "Variety", "Play 2 different games", C.DISTINCT_GAMES, null, 2, 25],
    [WIN, "win-1", "First blood", "Get a win", C.WIN, null, 1, 20],
    [WIN, "win-3", "Winning ways", "Win 3 matches", C.WIN, null, 3, 40],
    [WIN, "win-row-2", "Back to back", "Win 2 in a row today", C.WINS_IN_A_ROW, null, 2, 40],
    [GAME, "rps-win-2", "Rock on", "Win 2 Rock Paper Scissors matches", C.WIN, RPS, 2, 30],
    [GAME, "tictactoe-win-2", "Line them up", "Win 2 Tic Tac Toe matches", C.WIN, TIC_TAC_TOE, 2, 30],
    [GAME, "chess-play-1", "Opening move", "Play a game of Chess", C.PLAY, CHESS, 1, 25],
    [GAME, "chess-win-1", "Checkmate hunter", "Win a game of Chess", C.WIN, CHESS, 1, 50],
    [GAME, "rps-play-3", "Throw down", "Play 3 Rock Paper Scissors matches", C.PLAY, RPS, 3, 20],
    [GAME, "tictactoe-play-3", "Noughts warm-up", "Play 3 Tic Tac Toe matches", C.PLAY, TIC_TAC_TOE, 3, 20],
  ].map(quest),
);
