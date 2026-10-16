import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { verifyLegacyPassword } from "./legacyPassword.js";

describe("verifyLegacyPassword", () => {
  it.each(["$2a$", "$2b$"])("verifies %s bcrypt hashes from the legacy app", async (prefix) => {
    const hash = (await bcrypt.hash("old password", 4)).replace(/^\$2[ab]\$/, prefix);

    expect(await verifyLegacyPassword("old password", hash)).toBe(true);
    expect(await verifyLegacyPassword("wrong password", hash)).toBe(false);
  });

  it.each(["", "plain", "scrypt$32768$8$1$a$b", undefined, "$2b$10$tooshort"])(
    "never matches non-bcrypt input %j",
    async (hash) => {
      expect(await verifyLegacyPassword("anything", hash)).toBe(false);
    },
  );

  it("answers false instead of throwing when the password isn't text", async () => {
    const hash = bcrypt.hashSync("old password 1", 4);

    expect(await verifyLegacyPassword(undefined, hash)).toBe(false);
  });
});
