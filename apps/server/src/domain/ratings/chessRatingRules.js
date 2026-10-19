import { characterForGame, GAME_IDS } from "@classicade/shared";
import { BOT_ID_PREFIX } from "../../models/botIdentity.js";
import { earnsNothing } from "../../models/deletedPlayer.js";
import { creditFor } from "../matches/fairPlay.js";
import { resultFor } from "../progression/progressionComponent.js";
import { GLICKO2 } from "./glicko2.js";

/**
 * The chess rating's rules (ADR-027, ADR-062). Which games are rated, how a game scores, where a new player
 * starts and how a rating is shown. Pure functions: the component applies them.
 */
export const CHESS_RATING_RULES = Object.freeze({
  /** A rating is provisional, shown with a "?", until the player has this many rated games (ADR-027). */
  PROVISIONAL_GAMES: 10,
  /** Changes kept per player. A match among them is never rated twice. */
  KEPT_CHANGES: 200,
  /**
   * Where a player with no rated game starts after a counted game against Queen Vee, by the level picked (CC-221).
   * Accepted by default, the owner may change them (ADR-062).
   */
  SEEDS: Object.freeze({ easy: 1200, medium: 1500, hard: 1800 }),
});

const DAY_MS = 24 * 3_600_000;
const SCORES = Object.freeze({ win: 1, draw: 0.5, loss: 0, forfeit: 0 });
const QUEEN_VEE_PREFIX = `${BOT_ID_PREFIX}${characterForGame(GAME_IDS.CHESS).id}_`;

/**
 * Whether a game has a rating at all. Only chess does (ADR-027).
 *
 * @param {string} gameId
 */
export const isRatedGame = (gameId) => gameId === GAME_IDS.CHESS;
const isChess = (match) => isRatedGame(match.gameId);
const countsFor = (match, playerId) => creditFor(match, playerId).counted;

/**
 * The two people a game rates: a chess game between two people that counts for both under fair play (ADR-021).
 * A computer character (ADR-025) or a deleted player's stand-in in a seat means nobody is rated, and so does a game
 * that counts for one side only, because rating one side alone would move one rating and not the other.
 *
 * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
 * @returns {ReadonlyArray<string>} the two player ids, or none
 */
export function ratedPlayers(match) {
  const ids = match.players.map(({ playerId }) => playerId);
  const rated =
    isChess(match) && ids.length === 2 && ids.every((id) => !earnsNothing(id) && countsFor(match, id));
  return Object.freeze(rated ? ids : []);
}

/**
 * How the game scores for one player in Glicko-2: 1 for a win, a half for a draw, 0 for a loss or a forfeit.
 *
 * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
 * @param {string} playerId
 * @returns {number}
 */
export const scoreOf = (match, playerId) => SCORES[resultFor(match, playerId)];

/**
 * The starting rating a counted chess game against Queen Vee gives the person who played it, from the level they
 * picked. The game's result never moves a rating (ADR-025 point 2), it only says where to start.
 *
 * @param {Readonly<import("../../data/matchAccessor.js").Match>} match
 * @returns {ReadonlyArray<Readonly<{ playerId: string, level: string, rating: number }>>} one seed, or none
 */
export function seedsOf(match) {
  const queenVee = match.players.find(({ playerId }) => playerId.startsWith(QUEEN_VEE_PREFIX));
  const person = match.players.find(({ playerId }) => !earnsNothing(playerId));
  if (
    !isChess(match) ||
    queenVee === undefined ||
    person === undefined ||
    !countsFor(match, person.playerId)
  ) {
    return Object.freeze([]);
  }
  const level = queenVee.playerId.slice(QUEEN_VEE_PREFIX.length);
  return Object.freeze([
    Object.freeze({ playerId: person.playerId, level, rating: CHESS_RATING_RULES.SEEDS[level] }),
  ]);
}

/**
 * The rating periods between a player's last rated game and this one, at Lichess's pace. None when the player was
 * never rated (`from` is 0) or the games are out of order.
 *
 * @param {{ from: number, to: number }} span  ms since the epoch
 */
export const periodsBetween = ({ from, to }) =>
  from > 0 && to > from ? ((to - from) / DAY_MS) * GLICKO2.PERIODS_PER_DAY : 0;

/**
 * A rating as players see it: whole numbers, and whether it is still provisional.
 *
 * @param {Readonly<{ rating: number, deviation: number, games: number }>} rating
 * @returns {Readonly<{ rating: number, deviation: number, games: number, provisional: boolean }>}
 */
export const ratingView = ({ rating, deviation, games }) =>
  Object.freeze({
    rating: Math.round(rating),
    deviation: Math.round(deviation),
    games,
    provisional: games < CHESS_RATING_RULES.PROVISIONAL_GAMES,
  });

/**
 * What one match did to a rating, as the difference between the ratings shown before and after it.
 *
 * @param {{ changes: ReadonlyArray<import("../../data/chessRatingAccessor.js").RatingChange> }} rating
 * @param {string} matchId
 * @returns {ReadonlyArray<number>} the change, or none when the match did not change this rating
 */
export function changeIn({ changes }, matchId) {
  const change = changes.find((entry) => entry.matchId === matchId);
  return Object.freeze(
    change === undefined ? [] : [Math.round(change.after.rating) - Math.round(change.before.rating)],
  );
}
