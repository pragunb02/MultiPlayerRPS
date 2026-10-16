import { describe, expect, it } from "vitest";
import { createInMemoryAccountDao } from "../testing/inMemoryAccountDao.js";
import { ConflictError } from "../utils/errors.js";
import { createAccountAccessor } from "./accountAccessor.js";

const NOW = Date.UTC(2026, 9, 16);
const account = { username: "Riya", email: "riya@example.com", passwordHash: "scrypt$x", createdAt: NOW };

describe("accountAccessor", () => {
  it("creates frozen accounts with ms timestamps", async () => {
    const created = await createAccountAccessor({ accountDao: createInMemoryAccountDao() }).create(account);

    expect(created).toEqual({ accountId: expect.any(String), ...account });
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
    const accounts = createAccountAccessor({ accountDao: { insert: fail, getByEmail: fail } });

    await expect(accounts.create(account)).rejects.toBe(failure);
    await expect(accounts.findByEmail("riya@example.com")).rejects.toBe(failure);
  });
});
