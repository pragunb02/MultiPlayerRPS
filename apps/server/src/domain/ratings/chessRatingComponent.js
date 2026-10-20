import { earnsNothing } from "../../models/deletedPlayer.js";
import { assertDefined } from "../../utils/assert.js";
import {
  CHESS_RATING_RULES,
  changeIn,
  isRatedGame,
  periodsBetween,
  ratedPlayers,
  ratingView,
  scoreOf,
  seedsOf,
} from "./chessRatingRules.js";
import { aged, GLICKO2, rate } from "./glicko2.js";

/** Events the chess rating component publishes. */
export const CHESS_RATING_EVENTS = Object.freeze({
  /**
   * A rated game changed the players' ratings. Payload: { roomCode, matchId, ratings }, where `ratings` holds a
   * `RoomRating` for each of the two players, in the match's order. Published every time the step runs for a game
   * whose two changes are both written, so a crash after the writes and before the push is put right by the retry.
   * Listeners must accept the same update twice.
   */
  UPDATED: "chessRatings.updated",
});

/**
 * @typedef {import("../../data/chessRatingAccessor.js").ChessRating} ChessRating
 * @typedef {import("../../data/chessRatingAccessor.js").RatingChange} RatingChange
 * @typedef {Readonly<{ playerId: string, rating: number, deviation: number, games: number, provisional: boolean, change?: number }>} RoomRating
 *   a seat's rating as players see it. `playerId` is the seat's id. `change` is there when the room's game changed it
 */

const NONE = Object.freeze([]);
const glickoOf = ({ rating, deviation, volatility }) => Object.freeze({ rating, deviation, volatility });
const changeFor = (rating, matchId) => rating.changes.filter((change) => change.matchId === matchId);

/** The rating a player went into a game with: as stored when the game changed it already, or aged until it. */
function ratingBefore(rating, match) {
  const [stored] = changeFor(rating, match.matchId);
  if (stored !== undefined) {
    return stored.before;
  }
  return aged({
    player: glickoOf(rating),
    periods: periodsBetween({ from: rating.lastRatedAt, to: match.endedAt }),
  });
}

/** The rating with one more game. Only the last KEPT_CHANGES changes are kept. */
const withGame = (rating, change) =>
  Object.freeze({
    ...rating,
    ...change.after,
    games: rating.games + 1,
    lastRatedAt: Math.max(rating.lastRatedAt, change.at),
    changes: Object.freeze([...rating.changes, change].slice(-CHESS_RATING_RULES.KEPT_CHANGES)),
  });

/** A seat's rating for the room, with what the room's game changed. */
const roomRating = (playerId, rating, matchId) =>
  Object.freeze({
    playerId,
    ...ratingView(rating),
    ...Object.fromEntries(changeIn(rating, matchId).map((change) => ["change", change])),
  });

/**
 * The chess rating (CC-042, ADR-027, ADR-062): Glicko-2, one game is one rating period, rated games only.
 * `applyMatch` is a step of the match pipeline (ADR-047). It changes nothing when it runs again, and a run cut off
 * between the two players' writes finishes the second against the same ratings as the first. A write that lost a
 * race with another game of the same player fails with ConcurrentChangeError, and the pipeline runs it again.
 *
 * @param {{
 *   chessRatingAccessor: ReturnType<typeof import("../../data/chessRatingAccessor.js").createChessRatingAccessor>,
 *   events: { emit: (event: string, payload: unknown) => void },
 * }} deps
 */
export function createChessRatingComponent({ chessRatingAccessor, events }) {
  assertDefined(chessRatingAccessor, "chessRatingAccessor");
  assertDefined(events, "events");

  /** Sets where an unrated player starts, from the latest level they picked against Queen Vee (ADR-062). */
  async function seed({ playerId, level, rating }, at) {
    const current = await chessRatingAccessor.get(playerId);
    if (current.games > 0 || (current.seed !== undefined && current.seed.at >= at)) {
      return;
    }
    await chessRatingAccessor.save({
      rating: { ...current, ...GLICKO2.START, rating, seed: Object.freeze({ level, at }) },
      at,
    });
  }

  /** Rates both players once. Answers false when the two seats are one person now, so nobody is rated. */
  async function rateBoth(match, ids) {
    const ratings = [await chessRatingAccessor.get(ids[0]), await chessRatingAccessor.get(ids[1])];
    if (ratings[0].playerId === ratings[1].playerId) {
      return false;
    }
    const before = ratings.map((rating) => ratingBefore(rating, match));
    for (const [index, rating] of ratings.entries()) {
      if (changeFor(rating, match.matchId).length > 0) continue;
      const opponent = before[1 - index];
      const after = rate({ player: before[index], games: [{ opponent, score: scoreOf(match, ids[index]) }] });
      const change = Object.freeze({
        matchId: match.matchId,
        at: match.endedAt,
        before: before[index],
        after,
      });
      await chessRatingAccessor.save({ rating: withGame(rating, change), at: match.endedAt });
    }
    return true;
  }

  /** The rating of each person among `playerIds`, with what `matchId` changed. Computer players are left out. */
  async function ratingsOf({ gameId, playerIds, matchId }) {
    if (!isRatedGame(gameId)) {
      return NONE;
    }
    const views = [];
    for (const playerId of playerIds.filter((id) => !earnsNothing(id))) {
      views.push(roomRating(playerId, await chessRatingAccessor.get(playerId), matchId));
    }
    return Object.freeze(views);
  }

  return Object.freeze({
    /**
     * Rates a recorded, judged match once (the match pipeline's "apply chess ratings" step). A counted game
     * against Queen Vee only seeds an unrated player. Publishes the new ratings, also on a run that finds them written.
     *
     * @param {{ match: Readonly<import("../../data/matchAccessor.js").Match> }} input  as judged by fair play
     * @returns {Promise<ReadonlyArray<RoomRating>>} the two players' ratings after the game, or none when it is not rated
     * @throws {import("../../utils/errors.js").ConcurrentChangeError} when another game of a player was rated meanwhile
     */
    async applyMatch({ match }) {
      for (const seedOf of seedsOf(match)) {
        await seed(seedOf, match.endedAt);
      }
      const ids = ratedPlayers(match);
      if (ids.length === 0 || !(await rateBoth(match, ids))) {
        return NONE;
      }
      const ratings = await ratingsOf({ gameId: match.gameId, playerIds: ids, matchId: match.matchId });
      events.emit(CHESS_RATING_EVENTS.UPDATED, { roomCode: match.roomCode, matchId: match.matchId, ratings });
      return ratings;
    },

    /**
     * The ratings of a room's seats, with what the room's game changed. A game without a rating has none.
     *
     * @param {{ gameId: string, playerIds: ReadonlyArray<string>, matchId: string }} query  `matchId` is "" before
     *   a game started
     * @returns {Promise<ReadonlyArray<RoomRating>>}
     */
    ratingsOf,

    /**
     * A guest's rating moves to their account (ADR-014, ADR-062). The account keeps whichever rating has more
     * rated games, its own when they have as many. The other's changes stay, marked superseded, so none of those
     * games is rated again. The guest's document stays as a marker naming the account. Running it again, after a
     * crash or at the same time, changes nothing.
     *
     * @param {{ from: string, to: Readonly<{ id: string }>, now: number }} transfer
     * @returns {Promise<{ moved: Readonly<{ chessRatedGames: number }> }>} the guest's rated games that the account
     *   took over now
     * @throws {import("../../utils/errors.js").ConflictError} when the guest moved to another account, or the
     *   account's rating changed meanwhile (the transfer is resumed later)
     */
    async transferPlayer({ from, to, now }) {
      const guest = await chessRatingAccessor.markMerged({ from, to: to.id, at: now });
      const account = await chessRatingAccessor.get(to.id);
      if (account.mergedFrom.includes(from)) {
        return { moved: Object.freeze({ chessRatedGames: 0 }) };
      }
      const guestWins = guest.games > account.games;
      const [kept, superseded] = guestWins ? [guest, account] : [account, guest];
      const keptIds = new Set(kept.changes.map(({ matchId }) => matchId));
      const changes = [
        ...kept.changes,
        ...superseded.changes
          .filter(({ matchId }) => !keptIds.has(matchId))
          .map((change) => Object.freeze({ ...change, superseded: true })),
      ]
        .sort((x, y) => x.at - y.at)
        .slice(-CHESS_RATING_RULES.KEPT_CHANGES);
      await chessRatingAccessor.save({
        rating: Object.freeze({
          ...kept,
          playerId: account.playerId,
          changes: Object.freeze(changes),
          mergedFrom: Object.freeze([...account.mergedFrom, from]),
          revision: account.revision,
        }),
        at: now,
      });
      return { moved: Object.freeze({ chessRatedGames: guestWins ? guest.games : 0 }) };
    },

    /**
     * The player's chess rating for their data export (CC-035).
     *
     * @param {{ playerId: string }} query
     */
    async exportPlayer({ playerId }) {
      const rating = await chessRatingAccessor.get(playerId);
      return {
        ...glickoOf(rating),
        games: rating.games,
        provisional: ratingView(rating).provisional,
        ...(rating.seed && { seededFrom: rating.seed.level }),
        changes: rating.changes.map(({ at, ...change }) => ({ ...change, at: new Date(at).toISOString() })),
      };
    },

    /**
     * Deletes the player's rating, and the markers of guests who moved into it (CC-035). No other player's rating
     * names them. Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: { chessRatings: number } }>}
     */
    erasePlayer: async ({ playerId }) => ({
      erased: { chessRatings: await chessRatingAccessor.removePlayer(playerId) },
    }),
  });
}
