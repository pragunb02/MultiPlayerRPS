import { DuplicateKey } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";

/**
 * @typedef {Object} Account            domain model (frozen); the hash never leaves the server
 * @property {string} accountId
 * @property {string} username
 * @property {string} email
 * @property {string} passwordHash
 * @property {number} createdAt
 * @property {number} sessionVersion   sessions made at an older version are signed out (CC-116)
 */

const toAccount = (doc) => Object.freeze({ ...doc, createdAt: doc.createdAt.getTime() });

/** Storage reports "not there" as a RangeError. The domain hears NotFoundError. */
async function orNotFound(read) {
  try {
    return await read();
  } catch (err) {
    if (err instanceof RangeError) {
      throw new NotFoundError("Account not found", { cause: err });
    }
    throw err;
  }
}

/**
 * @param {{ accountDao: ReturnType<typeof import("../persistence/accountDao.js").createAccountDao> }} deps
 */
export function createAccountAccessor({ accountDao }) {
  assertDefined(accountDao, "accountDao");

  return Object.freeze({
    /**
     * @param {{ username: string, email: string, passwordHash: string, createdAt: number }} account
     * @returns {Promise<Readonly<Account>>}
     * @throws {ConflictError} with `details.field` "username" or "email"
     */
    async create({ username, email, passwordHash, createdAt }) {
      try {
        return toAccount(
          await accountDao.insert({ username, email, passwordHash, createdAt: new Date(createdAt) }),
        );
      } catch (err) {
        if (err instanceof DuplicateKey) {
          const message = err.field === "username" ? "That username is taken" : "That email can't be used";
          throw new ConflictError(message, { details: { field: err.field }, cause: err });
        }
        throw err;
      }
    },

    /**
     * @param {string} email  normalised
     * @returns {Promise<Readonly<Account>[]>} the account, or an empty list (lets callers keep timing uniform)
     */
    async findByEmail(email) {
      try {
        return [toAccount(await accountDao.getByEmail(email))];
      } catch (err) {
        if (err instanceof RangeError) {
          return [];
        }
        throw err;
      }
    },

    /** @param {string} accountId @param {string} passwordHash */
    updatePasswordHash: (accountId, passwordHash) => accountDao.updatePasswordHash(accountId, passwordHash),

    /**
     * @param {string} accountId
     * @returns {Promise<Readonly<Account>>}
     * @throws {NotFoundError}
     */
    getById: async (accountId) => toAccount(await orNotFound(() => accountDao.getById(accountId))),

    /**
     * @param {string} accountId
     * @returns {Promise<number>}
     * @throws {NotFoundError}
     */
    getSessionVersion: (accountId) => orNotFound(() => accountDao.getSessionVersion(accountId)),

    /**
     * Signs out every session made so far, and sets a new password hash at the same moment when one is given.
     *
     * @param {{ accountId: string, passwordHash?: string }} change
     * @returns {Promise<number>} the new session version
     * @throws {NotFoundError}
     */
    bumpSessionVersion: (change) => orNotFound(() => accountDao.bumpSessionVersion(change)),
  });
}
