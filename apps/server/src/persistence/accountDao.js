import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;
// Any character outside plain ASCII.
const NON_ASCII = "[^\\x00-\\x7F]";

/**
 * @typedef {Object} AccountDoc
 * @property {string} accountId      hex of the MongoDB ObjectId
 * @property {string} username       as chosen (display)
 * @property {string} email          normalised
 * @property {string} passwordHash
 * @property {Date} createdAt
 * @property {number} sessionVersion  counted up to sign out every session made before (CC-116)
 * @property {number} [birthYear]    only when the player stated one, a four digit year and never a date (CC-152)
 */

const accountSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    usernameKey: { type: String, required: true, unique: true }, // lower-case: "Riya" and "riya" are the same name
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, required: true },
    sessionVersion: { type: Number, required: true, default: 0 },
    // Left out when the player did not say. An unknown age counts as a minor (ADR-028).
    birthYear: { type: Number },
  },
  { collection: "accounts", versionKey: false },
);
// The owner console: "accounts created in this range" (CC-233).
accountSchema.index({ createdAt: 1 });

const toDoc = (doc) => ({
  accountId: doc._id.toHexString(),
  username: doc.username,
  email: doc.email,
  passwordHash: doc.passwordHash,
  createdAt: doc.createdAt,
  // Accounts made before CC-116 have no version stored. Their sessions were all made at version 0.
  sessionVersion: doc.sessionVersion ?? 0,
  ...(typeof doc.birthYear === "number" && { birthYear: doc.birthYear }),
});

const isId = (accountId) => mongoose.isValidObjectId(accountId);

/**
 * Player accounts in MongoDB.
 *
 * @param {{ connection: mongoose.Connection }} deps
 */
export function createAccountDao({ connection }) {
  const Account = connection.model("Account", accountSchema);

  return Object.freeze({
    ensureIndexes: () => Account.syncIndexes(),

    /**
     * @param {{ username: string, email: string, passwordHash: string, createdAt: Date, birthYear?: number }} account
     * @returns {Promise<AccountDoc>}
     * @throws {DuplicateKey} with `field` "username" or "email"
     */
    async insert({ username, email, passwordHash, createdAt, birthYear }) {
      try {
        const created = await Account.create({
          username,
          usernameKey: username.toLowerCase(),
          email,
          passwordHash,
          createdAt,
          ...(birthYear !== undefined && { birthYear }),
        });
        return toDoc(created);
      } catch (err) {
        if (err.code === DUPLICATE_KEY_CODE) {
          const field = Object.keys(err.keyPattern ?? {}).includes("email") ? "email" : "username";
          throw Object.assign(new DuplicateKey(`${field} already registered`, { cause: err }), { field });
        }
        throw err;
      }
    },

    /** @throws {RangeError} when no account has this email */
    async getByEmail(email) {
      const doc = await Account.findOne({ email }).lean();
      if (doc === null) {
        throw new RangeError("No account for that email");
      }
      return toDoc(doc);
    },

    /**
     * @param {string[]} emails  exact stored spellings
     * @returns {Promise<AccountDoc[]>} the accounts stored under any of them, oldest first
     */
    async listByEmails(emails) {
      const docs = await Account.find({ email: { $in: emails } })
        .sort({ _id: 1 })
        .lean();
      return docs.map(toDoc);
    },

    /**
     * Accounts whose stored email has a character outside plain ASCII. Only those can be stored in a spelling the
     * one email spelling would change (CC-245), so this reads few rows, and only their id and email.
     *
     * @returns {Promise<Array<{ accountId: string, email: string }>>}
     */
    async listNonAsciiEmails() {
      const docs = await Account.find({ email: { $regex: NON_ASCII } }, { email: 1 }).lean();
      return docs.map((doc) => ({ accountId: doc._id.toHexString(), email: doc.email }));
    },

    /**
     * Changes an account's stored email, only while it is still `from`.
     *
     * @param {{ accountId: string, from: string, to: string }} change
     * @returns {Promise<boolean>} whether it changed
     * @throws {DuplicateKey} with `field` "email" when another account already has `to`
     */
    async updateEmail({ accountId, from, to }) {
      try {
        const { modifiedCount } = await Account.updateOne(
          { _id: accountId, email: from },
          { $set: { email: to } },
        );
        return modifiedCount === 1;
      } catch (err) {
        if (err.code === DUPLICATE_KEY_CODE) {
          throw Object.assign(new DuplicateKey("email already registered", { cause: err }), {
            field: "email",
          });
        }
        throw err;
      }
    },

    /** @throws {RangeError} when absent */
    async getById(accountId) {
      const doc = mongoose.isValidObjectId(accountId) ? await Account.findById(accountId).lean() : null;
      if (doc === null) {
        throw new RangeError(`No account ${accountId}`);
      }
      return toDoc(doc);
    },

    async updatePasswordHash(accountId, passwordHash) {
      await Account.updateOne({ _id: accountId }, { $set: { passwordHash } });
    },

    /**
     * Only the session version, read by id on every request of a signed-in player, so it reads nothing else.
     *
     * @param {string} accountId
     * @returns {Promise<number>}
     * @throws {RangeError} when absent
     */
    async getSessionVersion(accountId) {
      const doc = mongoose.isValidObjectId(accountId)
        ? await Account.findById(accountId, { sessionVersion: 1 }).lean()
        : null;
      if (doc === null) {
        throw new RangeError(`No account ${accountId}`);
      }
      return doc.sessionVersion ?? 0;
    },

    /**
     * Counts the session version up, and in the same write sets a new password hash or a new username when one is
     * given. Every session made before no longer matches.
     *
     * @param {{ accountId: string, passwordHash?: string, username?: string }} change  a new username is the owner's
     *   rename of a reported name (CC-044)
     * @returns {Promise<number>} the new session version
     * @throws {RangeError} when absent
     * @throws {DuplicateKey} with `field` "username" when another account has that name
     */
    async bumpSessionVersion({ accountId, passwordHash, username }) {
      const set = {
        ...(passwordHash !== undefined && { passwordHash }),
        ...(username !== undefined && { username, usernameKey: username.toLowerCase() }),
      };
      let doc;
      try {
        doc = mongoose.isValidObjectId(accountId)
          ? await Account.findByIdAndUpdate(
              accountId,
              { $inc: { sessionVersion: 1 }, ...(Object.keys(set).length > 0 && { $set: set }) },
              { returnDocument: "after", projection: { sessionVersion: 1 } },
            ).lean()
          : null;
      } catch (err) {
        throw err.code === DUPLICATE_KEY_CODE
          ? Object.assign(new DuplicateKey("username already registered", { cause: err }), {
              field: "username",
            })
          : err;
      }
      if (doc === null) {
        throw new RangeError(`No account ${accountId}`);
      }
      return doc.sessionVersion;
    },

    /**
     * Sets the birth year of an account that has none. A year once set is never changed here (CC-152).
     *
     * @param {{ accountId: string, birthYear: number }} change
     * @returns {Promise<{ set: boolean }>} false when the account already had a year
     * @throws {RangeError} when absent
     */
    async setBirthYear({ accountId, birthYear }) {
      if (!isId(accountId)) {
        throw new RangeError(`No account ${accountId}`);
      }
      const updated = await Account.updateOne(
        { _id: accountId, birthYear: { $exists: false } },
        { $set: { birthYear } },
      );
      if (updated.modifiedCount === 1) {
        return { set: true };
      }
      if ((await Account.countDocuments({ _id: accountId }, { limit: 1 })) === 0) {
        throw new RangeError(`No account ${accountId}`);
      }
      return { set: false };
    },

    /**
     * The birth years of the given accounts, for those that stated one. Ids that are not accounts are skipped.
     *
     * @param {ReadonlyArray<string>} accountIds
     * @returns {Promise<Array<{ accountId: string, birthYear: number }>>}
     */
    async listBirthYears(accountIds) {
      const ids = accountIds.filter(isId);
      if (ids.length === 0) {
        return [];
      }
      const docs = await Account.find(
        { _id: { $in: ids }, birthYear: { $type: "number" } },
        { birthYear: 1 },
      ).lean();
      return docs.map((doc) => ({ accountId: doc._id.toHexString(), birthYear: doc.birthYear }));
    },

    /**
     * Deletes the account (CC-035). Running it again changes nothing.
     *
     * @param {string} accountId
     * @returns {Promise<{ deleted: boolean }>}
     */
    async deleteById(accountId) {
      if (!isId(accountId)) {
        return { deleted: false };
      }
      const { deletedCount } = await Account.deleteOne({ _id: accountId });
      return { deleted: deletedCount === 1 };
    },
  });
}
