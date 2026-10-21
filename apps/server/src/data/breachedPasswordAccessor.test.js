import { describe, expect, it } from "vitest";
import { createBreachedPasswordAccessor } from "./breachedPasswordAccessor.js";

// SHA-1 of "password" is 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8.
const PASSWORD_PREFIX = "5BAA6";
const PASSWORD_SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

/** A fake of the range client that answers one range for every prefix, and keeps the prefixes it was asked. */
function fakeRanges(entries) {
  const asked = [];
  return {
    asked,
    client: {
      rangeOf: async (prefix) => {
        asked.push(prefix);
        return new Map(entries);
      },
    },
  };
}

const commonPasswords = { has: (password) => ["password1", "qwertyuiop"].includes(password) };

describe("breachedPasswordAccessor", () => {
  it("sends only the first five hex characters of the password's SHA-1", async () => {
    const { client, asked } = fakeRanges([]);
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: client, commonPasswords });

    await accessor.isBreached("password");

    expect(asked).toEqual([PASSWORD_PREFIX]);
  });

  it("says a password is breached when its suffix is in the range with a count", async () => {
    const { client } = fakeRanges([[PASSWORD_SUFFIX, 10437277]]);
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: client, commonPasswords });

    expect(await accessor.isBreached("password")).toBe(true);
  });

  it("says a password is not breached when its suffix is missing", async () => {
    const { client } = fakeRanges([["003D68EB55068C33ACE09247EE4C639306B", 3]]);
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: client, commonPasswords });

    expect(await accessor.isBreached("password")).toBe(false);
  });

  it("does not count a padding line, whose count is 0", async () => {
    const { client } = fakeRanges([[PASSWORD_SUFFIX, 0]]);
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: client, commonPasswords });

    expect(await accessor.isBreached("password")).toBe(false);
  });

  it("passes a failure of the range client up", async () => {
    const failing = { rangeOf: async () => Promise.reject(new Error("timed out")) };
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: failing, commonPasswords });

    await expect(accessor.isBreached("password")).rejects.toThrow("timed out");
  });

  it("finds a common password in any capitals", () => {
    const { client } = fakeRanges([]);
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: client, commonPasswords });

    expect(accessor.isCommon("Password1")).toBe(true);
    expect(accessor.isCommon("QWERTYUIOP")).toBe(true);
    expect(accessor.isCommon("correct horse battery")).toBe(false);
  });

  it("needs both sources", () => {
    expect(() => createBreachedPasswordAccessor({ commonPasswords })).toThrow(TypeError);
    expect(() => createBreachedPasswordAccessor({ pwnedPasswords: {} })).toThrow(TypeError);
  });
});
