import { randomBytes } from "node:crypto";
import { DuplicateKey } from "../persistence/errors.js";

/** Test double with the same contract as `createAccountDao` (verified by the shared contract tests). */
export function createInMemoryAccountDao() {
  const accounts = new Map();
  const copy = (doc) => structuredClone(doc);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert({ username, email, passwordHash, createdAt }) {
      for (const existing of accounts.values()) {
        if (existing.email === email) {
          throw Object.assign(new DuplicateKey("email already registered"), { field: "email" });
        }
        if (existing.username.toLowerCase() === username.toLowerCase()) {
          throw Object.assign(new DuplicateKey("username already registered"), { field: "username" });
        }
      }
      const doc = {
        accountId: randomBytes(12).toString("hex"),
        username,
        email,
        passwordHash,
        createdAt: new Date(createdAt),
        sessionVersion: 0,
      };
      accounts.set(doc.accountId, doc);
      return copy(doc);
    },

    async getByEmail(email) {
      const doc = [...accounts.values()].find((account) => account.email === email);
      if (doc === undefined) {
        throw new RangeError("No account for that email");
      }
      return copy(doc);
    },

    async getById(accountId) {
      if (!accounts.has(accountId)) {
        throw new RangeError(`No account ${accountId}`);
      }
      return copy(accounts.get(accountId));
    },

    async updatePasswordHash(accountId, passwordHash) {
      const doc = accounts.get(accountId);
      if (doc !== undefined) {
        accounts.set(accountId, { ...doc, passwordHash });
      }
    },

    async getSessionVersion(accountId) {
      if (!accounts.has(accountId)) {
        throw new RangeError(`No account ${accountId}`);
      }
      return accounts.get(accountId).sessionVersion;
    },

    async bumpSessionVersion({ accountId, passwordHash }) {
      const doc = accounts.get(accountId);
      if (doc === undefined) {
        throw new RangeError(`No account ${accountId}`);
      }
      const next = {
        ...doc,
        sessionVersion: doc.sessionVersion + 1,
        ...(passwordHash !== undefined && { passwordHash }),
      };
      accounts.set(accountId, next);
      return next.sessionVersion;
    },
  });
}
