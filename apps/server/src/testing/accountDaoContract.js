import { expect, it } from "vitest";
import { DuplicateKey } from "../persistence/errors.js";

const NOW = new Date(Date.UTC(2026, 9, 16));
const account = (overrides = {}) => ({
  username: "Riya",
  email: "riya@example.com",
  passwordHash: "scrypt$x",
  createdAt: NOW,
  ...overrides,
});

/**
 * Behaviour every account DAO must have (MongoDB DAO and the in-memory double).
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/accountDao.js").createAccountDao>>} createDao
 */
export function runAccountDaoContract(createDao) {
  it("stores an account and finds it by email and by id", async () => {
    const dao = await createDao();

    const created = await dao.insert(account());

    expect(created).toEqual({
      accountId: expect.stringMatching(/^[0-9a-f]{24}$/),
      ...account(),
      sessionVersion: 0,
    });
    expect(await dao.getByEmail("riya@example.com")).toEqual(created);
    expect(await dao.getById(created.accountId)).toEqual(created);
  });

  it("refuses a second account with the same email", async () => {
    const dao = await createDao();
    await dao.insert(account());

    await expect(dao.insert(account({ username: "Other" }))).rejects.toMatchObject({
      constructor: DuplicateKey,
      field: "email",
    });
  });

  it("treats usernames as case-insensitive for uniqueness, but keeps the chosen casing", async () => {
    const dao = await createDao();
    const created = await dao.insert(account());

    await expect(dao.insert(account({ username: "rIYA", email: "other@example.com" }))).rejects.toMatchObject(
      {
        field: "username",
      },
    );
    expect(created.username).toBe("Riya");
  });

  // Two sign-ups at the same moment must not both pass a check made before either was stored (CC-245).
  it.each([
    ["email", { username: "Other" }],
    ["username", { username: "RIYA", email: "other@example.com" }],
  ])("stores one of two accounts with the same %s sent at the same moment", async (field, second) => {
    const dao = await createDao();

    const results = await Promise.allSettled([dao.insert(account()), dao.insert(account(second))]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [refused] = results.filter((result) => result.status === "rejected");
    expect(refused.reason).toMatchObject({ constructor: DuplicateKey, field });
  });

  // Accounts made before the one email spelling may be stored in another one (CC-245).
  it("lists the accounts stored under any of several spellings, oldest first", async () => {
    const dao = await createDao();
    const old = await dao.insert(account({ email: "ｒiya@example.com" }));
    const current = await dao.insert(account({ username: "Other", email: "riya@example.com" }));
    await dao.insert(account({ username: "Third", email: "third@example.com" }));

    const found = await dao.listByEmails(["riya@example.com", "ｒiya@example.com"]);

    expect(found.map((doc) => doc.accountId)).toEqual([old.accountId, current.accountId]);
    expect(await dao.listByEmails(["nobody@example.com"])).toEqual([]);
  });

  it("lists only the ids and emails of accounts whose email is not plain ASCII", async () => {
    const dao = await createDao();
    const old = await dao.insert(account({ email: "josé@example.com" }));
    await dao.insert(account({ username: "Other", email: "jose@example.com" }));

    expect(await dao.listNonAsciiEmails()).toEqual([{ accountId: old.accountId, email: "josé@example.com" }]);
  });

  it("changes a stored email only while it is still the old one, and never onto another account's", async () => {
    const dao = await createDao();
    const old = await dao.insert(account({ email: "ｒiya@example.com" }));
    const other = await dao.insert(account({ username: "Other", email: "other@example.com" }));

    expect(
      await dao.updateEmail({ accountId: old.accountId, from: "wrong@example.com", to: "x@example.com" }),
    ).toBe(false);
    await expect(
      dao.updateEmail({ accountId: old.accountId, from: "ｒiya@example.com", to: "other@example.com" }),
    ).rejects.toMatchObject({ constructor: DuplicateKey, field: "email" });
    expect(
      await dao.updateEmail({ accountId: old.accountId, from: "ｒiya@example.com", to: "riya@example.com" }),
    ).toBe(true);
    expect((await dao.getById(old.accountId)).email).toBe("riya@example.com");
    expect((await dao.getById(other.accountId)).email).toBe("other@example.com");
  });

  it("throws for unknown emails and ids", async () => {
    const dao = await createDao();

    await expect(dao.getByEmail("nobody@example.com")).rejects.toThrow(RangeError);
    await expect(dao.getById("0123456789abcdef01234567")).rejects.toThrow(RangeError);
    await expect(dao.getById("not-an-id")).rejects.toThrow(RangeError);
  });

  it("updates the password hash", async () => {
    const dao = await createDao();
    const { accountId } = await dao.insert(account());

    await dao.updatePasswordHash(accountId, "scrypt$new");

    expect((await dao.getById(accountId)).passwordHash).toBe("scrypt$new");
  });

  it("starts every account at session version 0 and reads only that by id (CC-116)", async () => {
    const dao = await createDao();
    const { accountId } = await dao.insert(account());

    expect(await dao.getSessionVersion(accountId)).toBe(0);
    await expect(dao.getSessionVersion("0123456789abcdef01234567")).rejects.toThrow(RangeError);
    await expect(dao.getSessionVersion("not-an-id")).rejects.toThrow(RangeError);
  });

  it("counts the session version up, alone or together with a new password", async () => {
    const dao = await createDao();
    const { accountId } = await dao.insert(account());

    expect(await dao.bumpSessionVersion({ accountId })).toBe(1);
    expect((await dao.getById(accountId)).passwordHash).toBe("scrypt$x");
    expect(await dao.bumpSessionVersion({ accountId, passwordHash: "scrypt$new" })).toBe(2);

    expect(await dao.getById(accountId)).toMatchObject({ passwordHash: "scrypt$new", sessionVersion: 2 });
    expect(await dao.getSessionVersion(accountId)).toBe(2);
  });

  it("refuses to count up the version of an account that is not there", async () => {
    const dao = await createDao();

    await expect(dao.bumpSessionVersion({ accountId: "0123456789abcdef01234567" })).rejects.toThrow(
      RangeError,
    );
    await expect(dao.bumpSessionVersion({ accountId: "not-an-id" })).rejects.toThrow(RangeError);
  });
}
