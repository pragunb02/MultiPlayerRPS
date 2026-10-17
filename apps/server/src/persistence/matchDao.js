import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;
const MATCH_SCHEMA_VERSION = 1;

/**
 * @typedef {Object} MatchDoc                 persistence object (dates as Date, no Mongo internals exposed)
 * @property {string} matchId
 * @property {string} roomCode
 * @property {string} gameId
 * @property {Record<string, unknown>} options
 * @property {number} seed
 * @property {Array<{ playerId: string, displayName: string }>} players
 * @property {Array<Record<string, unknown>>} log
 * @property {{ result: string, winners: string[], reason: string }} result
 * @property {Date} startedAt
 * @property {Date} endedAt
 * @property {number} schemaVersion
 * @property {MatchCreditDoc} [credit]   set once the match was judged (CC-095)
 *
 * @typedef {{ notCounted: Array<{ playerId: string, reason: string, withdrawnFrom?: string }> }} MatchCreditDoc
 *   the players the match does not count for. `withdrawnFrom` names the guest it counted for before the guest's
 *   games moved to this player
 */

const matchSchema = new mongoose.Schema(
  {
    matchId: { type: String, required: true, unique: true },
    roomCode: { type: String, required: true },
    gameId: { type: String, required: true },
    options: { type: mongoose.Schema.Types.Mixed, default: {} },
    seed: { type: Number, required: true },
    players: {
      type: [
        {
          _id: false,
          playerId: { type: String, required: true },
          displayName: { type: String, required: true },
        },
      ],
      required: true,
    },
    log: { type: [mongoose.Schema.Types.Mixed], default: [] },
    result: {
      result: { type: String, required: true },
      winners: { type: [String], default: [] },
      reason: { type: String, required: true },
    },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    schemaVersion: { type: Number, required: true, default: MATCH_SCHEMA_VERSION },
    // Absent until judged. Matches recorded before CC-095 never get one.
    credit: { type: mongoose.Schema.Types.Mixed },
  },
  { collection: "matches", minimize: false, versionKey: false },
);
// History pages: "my matches, newest first".
matchSchema.index({ "players.playerId": 1, endedAt: -1 });
// The owner console: "matches that ended in this range" (CC-233).
matchSchema.index({ endedAt: 1 });

const FIELDS =
  "-_id matchId roomCode gameId options seed players log result startedAt endedAt schemaVersion credit";
// A player's games that count for them: judged without them in `notCounted`, or not judged yet.
const countedFor = (playerId) => ({ "credit.notCounted.playerId": { $ne: playerId } });

/**
 * Finished matches in MongoDB — data we own, kept for history, replays and progression.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createMatchDao({ connection }) {
  const Match = connection.model("Match", matchSchema);

  return Object.freeze({
    /** Creates the collection's indexes; awaited at boot so queries never run unindexed. */
    ensureIndexes: () => Match.syncIndexes(),

    /**
     * @param {Omit<MatchDoc, "schemaVersion">} doc
     * @returns {Promise<MatchDoc>}
     * @throws {DuplicateKey} when the match was already recorded
     */
    async insert(doc) {
      try {
        await Match.create({ ...doc, schemaVersion: MATCH_SCHEMA_VERSION });
      } catch (err) {
        if (err.code === DUPLICATE_KEY_CODE) {
          throw new DuplicateKey(`Match ${doc.matchId} already recorded`, { cause: err });
        }
        throw err;
      }
      return this.getByMatchId(doc.matchId);
    },

    /**
     * @param {string} matchId
     * @returns {Promise<MatchDoc>}
     * @throws {RangeError} when absent
     */
    async getByMatchId(matchId) {
      const doc = await Match.findOne({ matchId }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`No match ${matchId}`);
      }
      return doc;
    },

    /**
     * @param {string} playerId
     * @param {{ limit: number, before?: Date }} page  newest first; `before` = exclusive upper bound on endedAt
     * @returns {Promise<MatchDoc[]>}
     */
    listByPlayer(playerId, { limit, before }) {
      const filter = { "players.playerId": playerId, ...(before && { endedAt: { $lt: before } }) };
      return Match.find(filter, FIELDS).sort({ endedAt: -1 }).limit(limit).lean();
    },

    /**
     * Every match `playerId` played that `excluding` did not (a guest's games, without those against the account
     * they are moving to), oldest first.
     *
     * @param {string} playerId
     * @param {{ excluding: string }} filter
     * @returns {Promise<MatchDoc[]>}
     */
    listByPlayerExcluding(playerId, { excluding }) {
      const filter = { $and: [{ "players.playerId": playerId }, { "players.playerId": { $ne: excluding } }] };
      return Match.find(filter, FIELDS).sort({ endedAt: 1 }).lean();
    },

    /**
     * Replaces a match with its renamed copy — only while `from` is still one of its players, so renaming twice
     * (or concurrently) changes it once.
     *
     * @param {{ matchId: string, from: string, doc: Omit<MatchDoc, "schemaVersion"> }} rename
     * @returns {Promise<boolean>} whether the match was renamed now
     */
    async renamePlayer({ matchId, from, doc }) {
      const { matchedCount } = await Match.replaceOne(
        { matchId, "players.playerId": from },
        { ...doc, matchId, schemaVersion: MATCH_SCHEMA_VERSION },
      );
      return matchedCount === 1;
    },

    /**
     * How many matches of one game a player won (forfeit wins included). Filtering on the player first lets the
     * history index serve it.
     *
     * @param {{ playerId: string, gameId: string }} query
     * @returns {Promise<number>}
     */
    countWins: ({ playerId, gameId }) =>
      Match.countDocuments({
        "players.playerId": playerId,
        gameId,
        "result.winners": playerId,
        ...countedFor(playerId),
      }),

    /**
     * Stores how a match counts, unless it was judged already: the first verdict stays.
     *
     * @param {{ matchId: string, credit: MatchCreditDoc }} verdict
     * @returns {Promise<MatchDoc>} the match as stored now
     * @throws {RangeError} when absent
     */
    async judgeOnce({ matchId, credit }) {
      await Match.updateOne({ matchId, credit: { $exists: false } }, { $set: { credit } });
      return this.getByMatchId(matchId);
    },

    /**
     * A player's games that count for them (or are not judged yet) and ended in `[from, to)`, without one match.
     * Only the fields the fair play limits look at.
     *
     * @param {string} playerId
     * @param {{ from: Date, to: Date, excluding: string }} window
     * @returns {Promise<Array<{ matchId: string, players: MatchDoc["players"], endedAt: Date }>>} oldest first
     */
    listCountedBetween(playerId, { from, to, excluding }) {
      const filter = {
        "players.playerId": playerId,
        endedAt: { $gte: from, $lt: to },
        matchId: { $ne: excluding },
        ...countedFor(playerId),
      };
      return Match.find(filter, "-_id matchId players endedAt").sort({ endedAt: 1 }).lean();
    },

    /**
     * The games of `playerId` that counted for guest `from`, but stopped counting when they moved to `playerId`.
     *
     * @param {{ playerId: string, from: string }} query
     * @returns {Promise<MatchDoc[]>} oldest first
     */
    listWithdrawn: ({ playerId, from }) =>
      Match.find(
        {
          "players.playerId": playerId,
          "credit.notCounted": { $elemMatch: { playerId, withdrawnFrom: from } },
        },
        FIELDS,
      )
        .sort({ endedAt: 1 })
        .lean(),
  });
}
