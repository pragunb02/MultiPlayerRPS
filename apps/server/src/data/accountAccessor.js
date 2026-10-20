import { ACCOUNT_MESSAGES } from "@classicade/shared";
import { aliasesOf } from "../models/credentials.js";
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
 * @property {number} [birthYear]      only when the player stated one (CC-152). Unknown counts as a minor
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
  /**
   * Accounts made before the one email spelling (CC-245) whose stored email it changes, by the spelling they
   * normalise to. Read at boot. No new account is stored that way, and each one is rewritten at its next login.
   *
   * @type {Map<string, string[]>}
   */
  let aliases = new Map();
  const emailTaken = () =>
    new ConflictError(ACCOUNT_MESSAGES.EMAIL_UNAVAILABLE, { details: { field: "email" } });

  return Object.freeze({
    /**
     * Reads which accounts are stored under a spelling the one email spelling changes, so login and sign-up
     * still see them. Only accounts with an email outside plain ASCII are read, and only their email.
     *
     * @returns {Promise<number>} how many accounts have such an email
     */
    async loadEmailAliases() {
      const stored = (await accountDao.listNonAsciiEmails()).map((account) => account.email);
      aliases = aliasesOf(stored, (email) => email);
      return [...aliases.values()].reduce((count, emails) => count + emails.length, 0);
    },

    /**
     * Refuses an email that an account already has in any spelling, also one stored before the one spelling.
     *
     * @param {{ username: string, email: string, passwordHash: string, createdAt: number, birthYear?: number }} account
     * @returns {Promise<Readonly<Account>>}
     * @throws {ConflictError} with `details.field` "username" or "email"
     */
    async create({ username, email, passwordHash, createdAt, birthYear }) {
      if (aliases.has(email)) {
        throw emailTaken();
      }
      try {
        return toAccount(
          await accountDao.insert({
            username,
            email,
            passwordHash,
            createdAt: new Date(createdAt),
            ...(birthYear !== undefined && { birthYear }),
          }),
        );
      } catch (err) {
        if (err instanceof DuplicateKey) {
          const message =
            err.field === "username" ? "That username is taken" : ACCOUNT_MESSAGES.EMAIL_UNAVAILABLE;
          throw new ConflictError(message, { details: { field: err.field }, cause: err });
        }
        throw err;
      }
    },

    /**
     * @param {string} email  normalised
     * @returns {Promise<Readonly<Account>[]>} the accounts with that email, oldest first, also those stored under an
     *   older spelling of it, or an empty list. One read either way, so callers keep timing uniform.
     */
    async findByEmail(email) {
      const docs = await accountDao.listByEmails([email, ...(aliases.get(email) ?? [])]);
      return Object.freeze(docs.map(toAccount));
    },

    /**
     * Rewrites an account's email stored under an older spelling to the one spelling, after a login proved the
     * password. Never onto an email another account already has.
     *
     * @param {{ accountId: string, from: string, to: string }} change
     * @returns {Promise<"rewritten" | "collision" | "unchanged">}
     */
    async healEmail({ accountId, from, to }) {
      try {
        const changed = await accountDao.updateEmail({ accountId, from, to });
        if (!changed) {
          return "unchanged";
        }
      } catch (err) {
        if (err instanceof DuplicateKey) {
          return "collision";
        }
        throw err;
      }
      const left = (aliases.get(to) ?? []).filter((email) => email !== from);
      if (left.length === 0) aliases.delete(to);
      else aliases.set(to, left);
      return "rewritten";
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

    /**
     * Sets the birth year of an account that has none (CC-152).
     *
     * @param {{ accountId: string, birthYear: number }} change
     * @returns {Promise<{ set: boolean }>} false when the account already had one
     * @throws {NotFoundError}
     */
    setBirthYear: (change) => orNotFound(() => accountDao.setBirthYear(change)),

    /**
     * @param {ReadonlyArray<string>} accountIds
     * @returns {Promise<ReadonlyArray<Readonly<{ accountId: string, birthYear: number }>>>} those with a stated year
     */
    listBirthYears: async (accountIds) =>
      Object.freeze((await accountDao.listBirthYears([...accountIds])).map((entry) => Object.freeze(entry))),

    /**
     * @param {ReadonlyArray<string>} accountIds
     * @returns {Promise<ReadonlyArray<Readonly<{ accountId: string, username: string }>>>} those that exist (CC-052)
     */
    listUsernames: async (accountIds) =>
      Object.freeze((await accountDao.listUsernames([...accountIds])).map((entry) => Object.freeze(entry))),

    /**
     * Deletes the account (CC-035). Deleting again changes nothing.
     *
     * @param {string} accountId
     * @returns {Promise<{ deleted: boolean }>}
     */
    delete: (accountId) => accountDao.deleteById(accountId),
  });
}
