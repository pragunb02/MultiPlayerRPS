import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {Object} ProfileDoc     persistence object: one player's public profile settings (CC-034)
 * @property {string} playerId       whose profile it is. Never sent to a client
 * @property {string} handle         the random address of the profile, the only id a client sees
 * @property {string} [avatar]       an avatar id from the catalogue, when the player picked one
 * @property {string} [visibility]   "public" or "private" once the player chose. Left out means the default
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

const profileSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true },
    handle: { type: String, required: true },
    avatar: { type: String },
    visibility: { type: String },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { collection: "player_profiles", versionKey: false },
);
// One profile per player, read by player for rooms, boards and history.
profileSchema.index({ playerId: 1 }, { unique: true });
// One player per handle, read by handle for the public page.
profileSchema.index({ handle: 1 }, { unique: true });

const FIELDS = "-_id playerId handle avatar visibility createdAt updatedAt";
const isDuplicate = (err) => err.code === DUPLICATE_KEY_CODE;

/** Runs a write and reports a clash with either unique index as DuplicateKey. */
async function guarded(write, message) {
  try {
    return await write();
  } catch (err) {
    if (isDuplicate(err)) throw new DuplicateKey(message, { cause: err });
    throw err;
  }
}

/**
 * Player profiles in MongoDB (CC-034, ADR-065).
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createProfileDao({ connection }) {
  const Profile = connection.model("PlayerProfile", profileSchema);

  return Object.freeze({
    ensureIndexes: () => Profile.syncIndexes(),

    /**
     * Stores a new profile.
     *
     * @param {{ playerId: string, handle: string, createdAt: Date }} profile
     * @returns {Promise<ProfileDoc>}
     * @throws {DuplicateKey} when the player has a profile already, or another player has that handle
     */
    async insert({ playerId, handle, createdAt }) {
      await guarded(
        () => Profile.create({ playerId, handle, createdAt, updatedAt: createdAt }),
        `A profile for ${playerId} or the handle exists already`,
      );
      return Profile.findOne({ playerId }, FIELDS).lean();
    },

    /**
     * @param {ReadonlyArray<string>} playerIds
     * @returns {Promise<ProfileDoc[]>} the profiles that exist, in no particular order
     */
    findByPlayers: (playerIds) => Profile.find({ playerId: { $in: [...playerIds] } }, FIELDS).lean(),

    /**
     * @param {string} handle
     * @returns {Promise<ProfileDoc>}
     * @throws {RangeError} when no profile has the handle
     */
    async getByHandle(handle) {
      const doc = await Profile.findOne({ handle }, FIELDS).lean();
      if (doc === null) {
        throw new RangeError("No profile has that handle");
      }
      return doc;
    },

    /**
     * Sets the given fields of a player's profile.
     *
     * @param {{ playerId: string, set: { avatar?: string, visibility?: string }, updatedAt: Date }} change
     * @returns {Promise<number>} profiles changed: 0 when the player has none
     */
    async update({ playerId, set, updatedAt }) {
      const { matchedCount } = await Profile.updateOne({ playerId }, { $set: { ...set, updatedAt } });
      return matchedCount;
    },

    /**
     * Gives the profile of `from` to `to`, who has none yet.
     *
     * @param {{ from: string, to: string }} transfer
     * @returns {Promise<number>} profiles moved: 0 when `from` has none
     * @throws {DuplicateKey} when `to` has a profile already
     */
    async rename({ from, to }) {
      const { modifiedCount } = await guarded(
        () => Profile.updateOne({ playerId: from }, { $set: { playerId: to } }),
        `${to} has a profile already`,
      );
      return modifiedCount;
    },

    /**
     * @param {string} playerId
     * @returns {Promise<number>} profiles deleted
     */
    async deleteByPlayer(playerId) {
      const { deletedCount } = await Profile.deleteOne({ playerId });
      return deletedCount;
    },
  });
}
