import { expect, it } from "vitest";

export const LEGACY_USERS = Object.freeze([
  {
    username: "Riya Sharma",
    email: "Riya@Example.com",
    password: "$2b$10$abcdefghijklmnopqrstuuJ3s0aMHvn1Z0r3oY0uJ5dU1xg4Nmq2",
    gamesPlayed: 40,
    level: 5,
  },
  {
    username: "bob",
    email: "bob@example.com",
    password: "$2b$10$zyxwvutsrqponmlkjihgfeQ6S7m0dIhq3m5bB5Y5pJ0G8T9wq0bJ2",
  },
  { username: "broken", email: "broken@example.com" }, // no password (corrupt legacy row)
]);

/**
 * Behaviour every legacy-user DAO must have (MongoDB and the in-memory double).
 *
 * @param {(seed: ReadonlyArray<object>) => Promise<{ getByEmail: Function }>} createDao
 */
export function runLegacyUserDaoContract(createDao) {
  it("finds a legacy user by email regardless of the case it was stored in", async () => {
    const dao = await createDao(LEGACY_USERS);

    expect(await dao.getByEmail("riya@example.com")).toEqual({
      username: "Riya Sharma",
      email: "Riya@Example.com",
      passwordHash: LEGACY_USERS[0].password,
    });
  });

  it("throws for unknown emails and for rows without a password", async () => {
    const dao = await createDao(LEGACY_USERS);

    await expect(dao.getByEmail("nobody@example.com")).rejects.toThrow(RangeError);
    await expect(dao.getByEmail("broken@example.com")).rejects.toThrow(RangeError);
  });

  it("treats regex characters in the email literally", async () => {
    const dao = await createDao(LEGACY_USERS);

    await expect(dao.getByEmail("r.ya@example.com")).rejects.toThrow(RangeError);
    await expect(dao.getByEmail(".*")).rejects.toThrow(RangeError);
  });
}
