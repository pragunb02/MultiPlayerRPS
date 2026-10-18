import { randomBytes } from "node:crypto";
import { DuplicateKey } from "../persistence/errors.js";

/** Test double with the same contract as `createAccountDao` (verified by the shared contract tests). */
export function createInMemoryAccountDao() {
  const accounts = new Map();
  const copy = (doc) => structuredClone(doc);

  return Object.freeze({
    ensureIndexes: async () => {},

    async insert({ username, email, passwordHash, createdAt, birthYear }) {
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
        ...(birthYear !== undefined && { birthYear }),
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

    async listByEmails(emails) {
      return [...accounts.values()].filter((account) => emails.includes(account.email)).map(copy);
    },

    async listNonAsciiEmails() {
      return [...accounts.values()]
        .filter((account) => [...account.email].some((char) => char.codePointAt(0) > 127))
        .map(({ accountId, email }) => ({ accountId, email }));
    },

    async updateEmail({ accountId, from, to }) {
      const doc = accounts.get(accountId);
      if (doc === undefined || doc.email !== from) {
        return false;
      }
      if ([...accounts.values()].some((account) => account.email === to)) {
        throw Object.assign(new DuplicateKey("email already registered"), { field: "email" });
      }
      accounts.set(accountId, { ...doc, email: to });
      return true;
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

    async setBirthYear({ accountId, birthYear }) {
      const doc = accounts.get(accountId);
      if (doc === undefined) {
        throw new RangeError(`No account ${accountId}`);
      }
      if (doc.birthYear !== undefined) {
        return { set: false };
      }
      accounts.set(accountId, { ...doc, birthYear });
      return { set: true };
    },

    async listBirthYears(accountIds) {
      return accountIds
        .map((accountId) => accounts.get(accountId))
        .filter((doc) => doc?.birthYear !== undefined)
        .map(({ accountId, birthYear }) => ({ accountId, birthYear }));
    },

    async deleteById(accountId) {
      return { deleted: accounts.delete(accountId) };
    },
  });
}
