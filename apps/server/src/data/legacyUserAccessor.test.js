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

  it("passes storage failures on instead of reporting nobody", async () => {
    const legacy = createLegacyUserAccessor({
      legacyUserDao: {
        getByEmail: async () => {
          throw new Error("database unavailable");
        },
      },
    });

    await expect(legacy.findByEmail("riya@example.com")).rejects.toThrow("database unavailable");
  });

  it("fails fast without its DAO", () => {
    expect(() => createLegacyUserAccessor({})).toThrow(TypeError);
  });
});
