import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBreachedPasswordAccessor } from "./breachedPasswordAccessor.js";

// A made up phrase, and the two halves of its SHA-1 as the range API splits them.
const PHRASE = "not-a-real-secret-phrase";
const PHRASE_SHA1 = createHash("sha1").update(PHRASE).digest("hex").toUpperCase();
const PASSWORD_PREFIX = PHRASE_SHA1.slice(0, 5);
const PASSWORD_SUFFIX = PHRASE_SHA1.slice(5);

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

    await accessor.isBreached(PHRASE);

    expect(asked).toEqual([PASSWORD_PREFIX]);
  });

  it("says a password is breached when its suffix is in the range with a count", async () => {
    const { client } = fakeRanges([[PASSWORD_SUFFIX, 10437277]]);
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: client, commonPasswords });

    expect(await accessor.isBreached(PHRASE)).toBe(true);
  });

  it("says a password is not breached when its suffix is missing", async () => {
    const { client } = fakeRanges([["003D68EB55068C33ACE09247EE4C639306B", 3]]);
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: client, commonPasswords });

    expect(await accessor.isBreached(PHRASE)).toBe(false);
  });

  it("does not count a padding line, whose count is 0", async () => {
    const { client } = fakeRanges([[PASSWORD_SUFFIX, 0]]);
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: client, commonPasswords });

    expect(await accessor.isBreached(PHRASE)).toBe(false);
  });

  it("passes a failure of the range client up", async () => {
    const failing = { rangeOf: async () => Promise.reject(new Error("timed out")) };
    const accessor = createBreachedPasswordAccessor({ pwnedPasswords: failing, commonPasswords });

    await expect(accessor.isBreached(PHRASE)).rejects.toThrow("timed out");
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
