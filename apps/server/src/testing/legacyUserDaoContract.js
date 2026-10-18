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
 * @param {(seed: ReadonlyArray<object>) => Promise<{ listByEmail: Function }>} createDao
 */
export function runLegacyUserDaoContract(createDao) {
  it("finds a legacy user by email regardless of the case it was stored in", async () => {
    const dao = await createDao(LEGACY_USERS);

    expect(await dao.listByEmail("riya@example.com")).toEqual([
      { username: "Riya Sharma", email: "Riya@Example.com", passwordHash: LEGACY_USERS[0].password },
    ]);
  });

  it("finds nobody for unknown emails and for rows without a password", async () => {
    const dao = await createDao(LEGACY_USERS);

    expect(await dao.listByEmail("nobody@example.com")).toEqual([]);
    expect(await dao.listByEmail("broken@example.com")).toEqual([]);
  });

  it("reads a legacy row without a username as an empty one (the migration picks a name)", async () => {
    const dao = await createDao([{ email: "nameless@example.com", password: LEGACY_USERS[0].password }]);

    expect((await dao.listByEmail("nameless@example.com"))[0].username).toBe("");
  });

  it("treats regex characters in the email literally", async () => {
    const dao = await createDao(LEGACY_USERS);

    expect(await dao.listByEmail("r.ya@example.com")).toEqual([]);
    expect(await dao.listByEmail(".*")).toEqual([]);
  });

  // The old app stored emails exactly as typed until CC-003, spaces included (CC-245).
  it("finds a legacy email stored with spaces around it", async () => {
    const dao = await createDao([{ ...LEGACY_USERS[1], email: "  Bob@Example.com " }]);

    expect(await dao.listByEmail("bob@example.com")).toEqual([
      { username: "bob", email: "  Bob@Example.com ", passwordHash: LEGACY_USERS[1].password },
    ]);
  });

  it("also finds rows by their exact stored email, for spellings a query cannot normalise", async () => {
    const dao = await createDao([
      ...LEGACY_USERS,
      { ...LEGACY_USERS[1], username: "wide", email: "ｗide@example.com" },
    ]);

    expect(await dao.listByEmail("wide@example.com")).toEqual([]);
    expect(
      (await dao.listByEmail("wide@example.com", ["ｗide@example.com"])).map((user) => user.username),
    ).toEqual(["wide"]);
  });

  it("lists only the legacy emails that are not plain ASCII", async () => {
    const dao = await createDao([...LEGACY_USERS, { ...LEGACY_USERS[1], email: "ｗide@example.com" }]);

    expect(await dao.listNonAsciiEmails()).toEqual(["ｗide@example.com"]);
  });

  it("returns every row that differs only in case, oldest first", async () => {
    const dao = await createDao([
      ...LEGACY_USERS,
      { ...LEGACY_USERS[1], username: "riya two", email: "riya@example.com" },
    ]);

    const found = await dao.listByEmail("riya@example.com");

    expect(found.map((user) => user.username)).toEqual(["Riya Sharma", "riya two"]);
  });
}
