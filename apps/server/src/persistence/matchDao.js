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
  },
  { collection: "matches", minimize: false, versionKey: false },
);
// History pages: "my matches, newest first".
matchSchema.index({ "players.playerId": 1, endedAt: -1 });

const FIELDS = "-_id matchId roomCode gameId options seed players log result startedAt endedAt schemaVersion";

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
  });
}
