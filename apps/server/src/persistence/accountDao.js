import mongoose from "mongoose";
import { DuplicateKey } from "./errors.js";

const DUPLICATE_KEY_CODE = 11000;

/**
 * @typedef {Object} AccountDoc
 * @property {string} accountId      hex of the MongoDB ObjectId
 * @property {string} username       as chosen (display)
 * @property {string} email          normalised
 * @property {string} passwordHash
 * @property {Date} createdAt
 */

const accountSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    usernameKey: { type: String, required: true, unique: true }, // lower-case: "Riya" and "riya" are the same name
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { collection: "accounts", versionKey: false },
);

const toDoc = (doc) => ({
  accountId: doc._id.toHexString(),
  username: doc.username,
  email: doc.email,
  passwordHash: doc.passwordHash,
  createdAt: doc.createdAt,
});

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
     * @param {{ username: string, email: string, passwordHash: string, createdAt: Date }} account
     * @returns {Promise<AccountDoc>}
     * @throws {DuplicateKey} with `field` "username" or "email"
     */
    async insert({ username, email, passwordHash, createdAt }) {
      try {
        const created = await Account.create({
          username,
          usernameKey: username.toLowerCase(),
          email,
          passwordHash,
          createdAt,
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
  });
}
