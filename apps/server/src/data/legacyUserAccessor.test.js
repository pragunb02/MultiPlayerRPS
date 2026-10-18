import { describe, expect, it } from "vitest";
import { createInMemoryLegacyUserDao } from "../testing/inMemoryLegacyUserDao.js";
import { LEGACY_USERS } from "../testing/legacyUserDaoContract.js";
import { createLegacyUserAccessor } from "./legacyUserAccessor.js";

describe("legacyUserAccessor", () => {
  it("finds a legacy user, or nobody", async () => {
    const legacy = createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao(LEGACY_USERS) });

    expect(await legacy.findByEmail("riya@example.com")).toEqual([
      expect.objectContaining({ username: "Riya Sharma" }),
    ]);
    expect(await legacy.findByEmail("nobody@example.com")).toEqual([]);
  });

  it("finds every legacy user with that email, frozen", async () => {
    const legacy = createLegacyUserAccessor({
      legacyUserDao: createInMemoryLegacyUserDao([
        ...LEGACY_USERS,
        { username: "riya two", email: "riya@example.com", password: LEGACY_USERS[0].password },
      ]),
    });

    const found = await legacy.findByEmail("riya@example.com");

    expect(found).toHaveLength(2);
    expect(Object.isFrozen(found)).toBe(true);
    expect(found.every((user) => Object.isFrozen(user))).toBe(true);
  });

  // A query can fold case and spaces, not Unicode forms, so those rows are read once and found by their exact text.
  it("counts and finds the legacy rows stored in a spelling a query cannot normalise (CC-245)", async () => {
    const legacy = createLegacyUserAccessor({
      legacyUserDao: createInMemoryLegacyUserDao([
        ...LEGACY_USERS,
        { username: "wide", email: " ｗIDE@Example.com", password: LEGACY_USERS[0].password },
        { username: "jose", email: "josé@example.com", password: LEGACY_USERS[0].password },
      ]),
    });

    expect(await legacy.findByEmail("wide@example.com")).toEqual([]);
    expect(await legacy.loadEmailAliases()).toBe(1);
    expect((await legacy.findByEmail("wide@example.com")).map((user) => user.username)).toEqual(["wide"]);
    expect((await legacy.findByEmail("josé@example.com")).map((user) => user.username)).toEqual(["jose"]);
  });

  it("passes storage failures on instead of reporting nobody", async () => {
    const legacy = createLegacyUserAccessor({
      legacyUserDao: {
        listByEmail: async () => {
          throw new Error("database unavailable");
        },
      },
    });

    await expect(legacy.findByEmail("riya@example.com")).rejects.toThrow("database unavailable");
  });

  it("fails fast without its DAO", () => {
    expect(() => createLegacyUserAccessor({})).toThrow(TypeError);
  });

  it("names the legacy row by its id, so a closed row can be recognised (CC-035)", async () => {
    const legacy = createLegacyUserAccessor({ legacyUserDao: createInMemoryLegacyUserDao(LEGACY_USERS) });

    const [found] = await legacy.findByEmail("riya@example.com");

    expect(found.legacyId).toBe("legacy-0");
  });
});
