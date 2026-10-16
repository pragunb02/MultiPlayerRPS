import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {Object} PlayerTransferDoc        persistence object: one guest's data moving to an account (CC-032)
 * @property {string} from                      the guest's player id (unique: a guest moves once)
 * @property {{ kind: string, id: string, displayName: string }} to   the account it moves to
 * @property {"pending" | "done"} status
 * @property {Date} createdAt
 * @property {Date} [completedAt]
 * @property {{ xp: number, matchesPlayed: number, matches: number }} [carriedOver]  what moved, once done
 */

const transferSchema = new mongoose.Schema(
  {
    from: { type: String, required: true, unique: true },
    to: {
      _id: false,
      kind: { type: String, required: true },
      id: { type: String, required: true },
      displayName: { type: String, required: true },
    },
    status: { type: String, required: true, enum: ["pending", "done"] },
    createdAt: { type: Date, required: true },
    completedAt: { type: Date },
    carriedOver: {
      type: new mongoose.Schema({ xp: Number, matchesPlayed: Number, matches: Number }, { _id: false }),
      default: undefined,
    },
  },
  { collection: "player_transfers", versionKey: false },
);
// Housekeeping: "pending transfers older than …".
transferSchema.index({ status: 1, createdAt: 1 });

const FIELDS = "-_id from to status createdAt completedAt carriedOver";

/**
 * Guest → account transfers in MongoDB: the record that makes moving a guest's data exactly-once and resumable.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createPlayerTransferDao({ connection }) {
  const Transfer = connection.model("PlayerTransfer", transferSchema);

  return Object.freeze({
    ensureIndexes: () => Transfer.syncIndexes(),

    /**
     * @param {{ from: string, to: PlayerTransferDoc["to"], createdAt: Date }} transfer
     * @returns {Promise<PlayerTransferDoc>}
     * @throws {DuplicateKey} when this guest already has a transfer
     */
    async insertPending({ from, to, createdAt }) {
      try {
        await Transfer.create({ from, to, status: "pending", createdAt });
      } catch (err) {
        if (err.code === DUPLICATE_KEY_CODE) {
          throw new DuplicateKey(`Transfer from ${from} already exists`, { cause: err });
        }
        throw err;
      }
      return this.getByFrom(from);
    },

    /**
     * @param {string} from
     * @returns {Promise<PlayerTransferDoc>}
     * @throws {RangeError} when absent
     */
    async getByFrom(from) {
      const doc = await Transfer.findOne({ from }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError(`No transfer from ${from}`);
      }
      return doc;
    },

    /**
     * Marks a transfer finished, recording what moved. Marking it again changes nothing.
     *
     * @param {{ from: string, completedAt: Date, carriedOver: NonNullable<PlayerTransferDoc["carriedOver"]> }} done
     */
    async markDone({ from, completedAt, carriedOver }) {
      await Transfer.updateOne(
        { from, status: "pending" },
        { $set: { status: "done", completedAt, carriedOver } },
      );
    },

    /**
     * @param {{ createdBefore: Date, limit: number }} query  oldest first
     * @returns {Promise<PlayerTransferDoc[]>}
     */
    listPending({ createdBefore, limit }) {
      return Transfer.find({ status: "pending", createdAt: { $lt: createdBefore } }, FIELDS)
        .sort({ createdAt: 1 })
        .limit(limit)
        .lean();
    },

    /**
     * @param {string[]} froms  player ids
     * @returns {Promise<PlayerTransferDoc[]>} the transfers of whichever of them have one
     */
    listByFrom(froms) {
      return Transfer.find({ from: { $in: froms } }, FIELDS).lean();
    },
  });
}
