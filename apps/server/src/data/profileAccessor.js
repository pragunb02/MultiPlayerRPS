import { DuplicateKey } from "../persistence/errors.js";
import { newProfileHandle } from "../models/profileHandle.js";
import { assertDefined, assertFunction } from "../utils/assert.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";

// Two handles out of 2^80 meet almost never, and a second clash in a row is a broken generator, not bad luck.
const HANDLE_ATTEMPTS = 3;

/**
 * @typedef {Object} Profile       domain model (frozen, times in ms): one player's profile settings (CC-034)
 * @property {string} playerId
 * @property {string} handle         the random address of the profile
 * @property {string} [avatar]       an avatar id, when the player picked one
 * @property {string} [visibility]   "public" or "private" once the player chose
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/** @returns {Readonly<Profile>} */
const toProfile = ({ createdAt, updatedAt, ...doc }) =>
  Object.freeze({
    ...Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined && value !== null)),
    createdAt: createdAt.getTime(),
    updatedAt: updatedAt.getTime(),
  });

/**
 * Provides player profiles to the domain (CC-034, ADR-065). A profile is made, with a fresh random handle, the first
 * time anything asks for it, so players from before profiles existed need no migration.
 *
 * @param {{
 *   profileDao: ReturnType<typeof import("../persistence/profileDao.js").createProfileDao>,
 *   newHandle?: () => string,   for tests only
 * }} deps
 */
export function createProfileAccessor({ profileDao, newHandle = newProfileHandle }) {
  assertDefined(profileDao, "profileDao");
  assertFunction(newHandle, "newHandle");

  /** The profiles that exist among `playerIds`, by player id. */
  async function findMany(playerIds) {
    const docs = playerIds.length === 0 ? [] : await profileDao.findByPlayers(playerIds);
    return new Map(docs.map((doc) => [doc.playerId, toProfile(doc)]));
  }

  /**
   * The player's profile, made now when there is none. A clash on the player means someone else made it a moment
   * ago, so it is read. A clash on the handle gets a new handle.
   */
  async function getOrCreate({ playerId, at }) {
    for (let attempt = 0; attempt < HANDLE_ATTEMPTS; attempt++) {
      const existing = (await findMany([playerId])).get(playerId);
      if (existing !== undefined) return existing;
      try {
        return toProfile(await profileDao.insert({ playerId, handle: newHandle(), createdAt: new Date(at) }));
      } catch (err) {
        if (!(err instanceof DuplicateKey)) throw err;
      }
    }
    throw new Error(`Could not make a profile for ${playerId} after ${HANDLE_ATTEMPTS} attempts`);
  }

  return Object.freeze({
    /**
     * @param {ReadonlyArray<string>} playerIds
     * @returns {Promise<ReadonlyMap<string, Readonly<Profile>>>} the profiles that exist, nothing is made
     */
    findMany,

    /**
     * @param {{ playerId: string, at: number }} input
     * @returns {Promise<Readonly<Profile>>}
     */
    getOrCreate,

    /**
     * Every player's profile, made now for those without one.
     *
     * @param {{ playerIds: ReadonlyArray<string>, at: number }} input
     * @returns {Promise<ReadonlyMap<string, Readonly<Profile>>>}
     */
    async getOrCreateMany({ playerIds, at }) {
      const found = new Map(await findMany(playerIds));
      for (const playerId of new Set(playerIds)) {
        if (!found.has(playerId)) found.set(playerId, await getOrCreate({ playerId, at }));
      }
      return found;
    },

    /**
     * @param {string} handle
     * @returns {Promise<Readonly<Profile>>}
     * @throws {NotFoundError} when no profile has the handle
     */
    async getByHandle(handle) {
      try {
        return toProfile(await profileDao.getByHandle(handle));
      } catch (err) {
        if (err instanceof RangeError) throw new NotFoundError("No such profile", { cause: err });
        throw err;
      }
    },

    /**
     * Sets the avatar or the visibility, making the profile first when there is none.
     *
     * @param {{ playerId: string, set: { avatar?: string, visibility?: string }, at: number }} change
     * @returns {Promise<Readonly<Profile>>} the profile after the change
     */
    async update({ playerId, set, at }) {
      await getOrCreate({ playerId, at });
      await profileDao.update({ playerId, set, updatedAt: new Date(at) });
      return getOrCreate({ playerId, at });
    },

    /**
     * Gives the profile of `from` to `to`, who has none.
     *
     * @param {{ from: string, to: string }} transfer
     * @returns {Promise<boolean>} whether a profile moved
     * @throws {ConflictError} when `to` has a profile already
     */
    async rename(transfer) {
      try {
        return (await profileDao.rename(transfer)) > 0;
      } catch (err) {
        if (err instanceof DuplicateKey)
          throw new ConflictError("That player has a profile already", { cause: err });
        throw err;
      }
    },

    /** @param {string} playerId @returns {Promise<number>} profiles removed */
    remove: (playerId) => profileDao.deleteByPlayer(playerId),
  });
}
