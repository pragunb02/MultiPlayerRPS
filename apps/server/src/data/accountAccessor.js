import { DuplicateKey } from "../persistence/errors.js";
import { assertDefined } from "../utils/assert.js";
import { ConflictError } from "../utils/errors.js";

/**
 * @typedef {Object} Account            domain model (frozen); the hash never leaves the server
 * @property {string} accountId
 * @property {string} username
 * @property {string} email
 * @property {string} passwordHash
 * @property {number} createdAt
 */

const toAccount = (doc) => Object.freeze({ ...doc, createdAt: doc.createdAt.getTime() });

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
  });
}
