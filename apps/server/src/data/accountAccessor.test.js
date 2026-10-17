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
});
