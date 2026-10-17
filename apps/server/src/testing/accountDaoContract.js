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
