import { describe, expect, it } from "vitest";
import { createInMemoryAccountDao } from "../testing/inMemoryAccountDao.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { createAccountAccessor } from "./accountAccessor.js";

const NOW = Date.UTC(2026, 9, 16);
const account = { username: "Riya", email: "riya@example.com", passwordHash: "scrypt$x", createdAt: NOW };

describe("accountAccessor", () => {
  it("creates frozen accounts with ms timestamps", async () => {
    const created = await createAccountAccessor({ accountDao: createInMemoryAccountDao() }).create(account);

    expect(created).toEqual({ accountId: expect.any(String), ...account, sessionVersion: 0 });
    expect(Object.isFrozen(created)).toBe(true);
  });

  it("finds by email as a list (empty when unknown)", async () => {
    const accounts = createAccountAccessor({ accountDao: createInMemoryAccountDao() });
    await accounts.create(account);

    expect(await accounts.findByEmail("riya@example.com")).toHaveLength(1);
    expect(await accounts.findByEmail("nobody@example.com")).toEqual([]);
  });

  // Accounts stored under an older email spelling (CC-245).
  describe("emails stored under an older spelling", () => {
    async function withOld() {
      const accountDao = createInMemoryAccountDao();
      const old = await accountDao.insert({
        ...account,
        email: "ｒiya@example.com",
        createdAt: new Date(NOW),
      });
      await accountDao.insert({
        ...account,
        username: "Ascii",
        email: "ascii@example.com",
        createdAt: new Date(NOW),
      });
      await accountDao.insert({
        ...account,
        username: "Jose",
        email: "josé@example.com",
        createdAt: new Date(NOW),
      });
      return { accountDao, old, accounts: createAccountAccessor({ accountDao }) };
    }

    it("counts only the accounts whose stored email the one spelling changes", async () => {
      const { accounts } = await withOld();

      expect(await accounts.loadEmailAliases()).toBe(1);
    });

    it("finds them under the one spelling, and refuses a new account with it", async () => {
      const { accounts, old } = await withOld();
      await accounts.loadEmailAliases();

      expect((await accounts.findByEmail("riya@example.com")).map((found) => found.accountId)).toEqual([
        old.accountId,
      ]);
      await expect(accounts.create({ ...account, username: "Thief" })).rejects.toMatchObject({
        constructor: ConflictError,
        details: { field: "email" },
      });
    });

    it("rewrites one to the one spelling once, and still refuses a new account with it", async () => {
      const { accounts, accountDao, old } = await withOld();
      await accounts.loadEmailAliases();

      expect(
        await accounts.healEmail({ accountId: old.accountId, from: "ｒiya@example.com", to: account.email }),
      ).toBe("rewritten");
      expect((await accountDao.getById(old.accountId)).email).toBe(account.email);
      await expect(accounts.create({ ...account, username: "Thief" })).rejects.toMatchObject({
        details: { field: "email" },
      });
      expect(
        await accounts.healEmail({ accountId: old.accountId, from: "ｒiya@example.com", to: account.email }),
      ).toBe("unchanged");
    });

    it("never rewrites onto another account's email, and passes other failures on", async () => {
      const { accounts, accountDao, old } = await withOld();
      await accounts.loadEmailAliases();
      await accountDao.insert({ ...account, username: "Other", createdAt: new Date(NOW) });

      expect(
        await accounts.healEmail({ accountId: old.accountId, from: "ｒiya@example.com", to: account.email }),
      ).toBe("collision");
      const failing = createAccountAccessor({
        accountDao: {
          ...accountDao,
          updateEmail: async () => {
            throw new Error("database unavailable");
          },
        },
      });
      await expect(failing.healEmail({ accountId: old.accountId, from: "x", to: "y" })).rejects.toThrow(
        "database unavailable",
      );
    });

    it("rewrites an old spelling it was not told about at boot", async () => {
      const { accountDao, old } = await withOld();

      const accounts = createAccountAccessor({ accountDao });

      expect(
        await accounts.healEmail({ accountId: old.accountId, from: "ｒiya@example.com", to: account.email }),
      ).toBe("rewritten");
    });

    it("keeps the other old spellings of the same email after one is rewritten", async () => {
      const accountDao = createInMemoryAccountDao();
      const first = await accountDao.insert({
        ...account,
        email: "ｒiya@example.com",
        createdAt: new Date(NOW),
      });
      await accountDao.insert({
        ...account,
        username: "Two",
        email: "ｒｉya@example.com",
        createdAt: new Date(NOW),
      });
      const accounts = createAccountAccessor({ accountDao });
      await accounts.loadEmailAliases();

      await accounts.healEmail({ accountId: first.accountId, from: "ｒiya@example.com", to: account.email });

      expect((await accounts.findByEmail(account.email)).map((found) => found.username).sort()).toEqual([
        "Riya",
        "Two",
      ]);
    });
  });

  it("translates duplicates into ConflictError naming the field", async () => {
    const accounts = createAccountAccessor({ accountDao: createInMemoryAccountDao() });
    await accounts.create(account);

    await expect(accounts.create({ ...account, username: "Other" })).rejects.toMatchObject({
      constructor: ConflictError,
      details: { field: "email" },
    });
  });

  it("passes unexpected storage failures through unchanged", async () => {
    const failure = new Error("disk on fire");
    const fail = async () => {
      throw failure;
    };
    const accounts = createAccountAccessor({
      accountDao: {
        insert: fail,
        getByEmail: fail,
        listByEmails: fail,
        getById: fail,
        getSessionVersion: fail,
        bumpSessionVersion: fail,
      },
    });

    await expect(accounts.create(account)).rejects.toBe(failure);
    await expect(accounts.findByEmail("riya@example.com")).rejects.toBe(failure);
    await expect(accounts.getById("x")).rejects.toBe(failure);
    await expect(accounts.getSessionVersion("x")).rejects.toBe(failure);
    await expect(accounts.bumpSessionVersion({ accountId: "x" })).rejects.toBe(failure);
  });

  it("reads an account and its session version by id, and counts the version up (CC-116)", async () => {
    const accounts = createAccountAccessor({ accountDao: createInMemoryAccountDao() });
    const { accountId } = await accounts.create(account);

    expect(await accounts.getById(accountId)).toMatchObject({ accountId, createdAt: NOW, sessionVersion: 0 });
    expect(await accounts.bumpSessionVersion({ accountId, passwordHash: "scrypt$y" })).toBe(1);
    expect(await accounts.getSessionVersion(accountId)).toBe(1);
    expect((await accounts.getById(accountId)).passwordHash).toBe("scrypt$y");
  });

  it("translates a missing account into NotFoundError", async () => {
    const accounts = createAccountAccessor({ accountDao: createInMemoryAccountDao() });

    await expect(accounts.getById("nope")).rejects.toThrow(NotFoundError);
    await expect(accounts.getSessionVersion("nope")).rejects.toThrow(NotFoundError);
    await expect(accounts.bumpSessionVersion({ accountId: "nope" })).rejects.toThrow(NotFoundError);
  });

  it("keeps a stated birth year and sets one once (CC-152)", async () => {
    const accounts = createAccountAccessor({ accountDao: createInMemoryAccountDao() });
    const stated = await accounts.create({ ...account, birthYear: 2001 });
    const unstated = await accounts.create({ ...account, username: "Arjun", email: "arjun@example.com" });

    expect(stated.birthYear).toBe(2001);
    expect(await accounts.setBirthYear({ accountId: unstated.accountId, birthYear: 1999 })).toEqual({
      set: true,
    });
    expect(await accounts.setBirthYear({ accountId: unstated.accountId, birthYear: 1990 })).toEqual({
      set: false,
    });
    expect((await accounts.getById(unstated.accountId)).birthYear).toBe(1999);
    await expect(accounts.setBirthYear({ accountId: "nobody", birthYear: 1999 })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("lists the birth years of the accounts asked for, as a frozen list (CC-152)", async () => {
    const accounts = createAccountAccessor({ accountDao: createInMemoryAccountDao() });
    const stated = await accounts.create({ ...account, birthYear: 1990 });

    const years = await accounts.listBirthYears([stated.accountId, "nobody"]);

    expect(years).toEqual([{ accountId: stated.accountId, birthYear: 1990 }]);
    expect(Object.isFrozen(years)).toBe(true);
  });

  it("deletes an account, and a second delete reports nothing deleted (CC-035)", async () => {
    const accounts = createAccountAccessor({ accountDao: createInMemoryAccountDao() });
    const { accountId } = await accounts.create(account);

    expect(await accounts.delete(accountId)).toEqual({ deleted: true });
    expect(await accounts.delete(accountId)).toEqual({ deleted: false });
    await expect(accounts.getById(accountId)).rejects.toThrow(NotFoundError);
  });
});
