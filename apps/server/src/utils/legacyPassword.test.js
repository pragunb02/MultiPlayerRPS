import bcrypt from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLegacyPasswordChecker, LEGACY_BCRYPT_COST } from "./legacyPassword.js";

const checker = () => createLegacyPasswordChecker({ dummyCost: 4 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLegacyPasswordChecker", () => {
  it.each(["$2a$", "$2b$"])("verifies %s bcrypt hashes from the legacy app", async (prefix) => {
    const hash = (await bcrypt.hash("old password", 4)).replace(/^\$2[ab]\$/, prefix);

    expect(await checker().verify("old password", hash)).toBe(true);
    expect(await checker().verify("wrong password", hash)).toBe(false);
  });

  it.each(["", "plain", "scrypt$32768$8$1$a$b", undefined, "$2b$10$tooshort"])(
    "never matches non-bcrypt input %j",
    async (hash) => {
      expect(await checker().verify("anything", hash)).toBe(false);
    },
  );

  it("answers false instead of throwing when the password isn't text", async () => {
    const hash = bcrypt.hashSync("old password 1", 4);

    expect(await checker().verify(undefined, hash)).toBe(false);
  });

  // The time a login takes must not tell a corrupt legacy row or a missing one from a real one (CC-245).
  it.each([
    ["a real hash", (legacy) => legacy.verify("guess", bcrypt.hashSync("old password 1", 4))],
    ["a hash that is not bcrypt", (legacy) => legacy.verify("guess", "plain")],
    ["no hash at all", (legacy) => legacy.verifyAgainstDummy("guess")],
  ])("runs exactly one bcrypt check for %s", async (_, check) => {
    const legacy = checker();
    await legacy.verifyAgainstDummy("warm up");
    const compare = vi.spyOn(bcrypt, "compare");

    expect(await check(legacy)).toBe(false);

    expect(compare).toHaveBeenCalledOnce();
  });

  it("checks against a dummy at the old app's cost unless told otherwise", async () => {
    const hashed = vi.spyOn(bcrypt, "hash");

    await createLegacyPasswordChecker().verifyAgainstDummy("guess");

    expect(LEGACY_BCRYPT_COST).toBe(10);
    expect(hashed).toHaveBeenCalledWith(expect.any(String), LEGACY_BCRYPT_COST);
  });
});
