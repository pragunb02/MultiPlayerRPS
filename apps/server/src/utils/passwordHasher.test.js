import { describe, expect, it } from "vitest";
import { createPasswordHasher } from "./passwordHasher.js";

// Cheap parameters keep the tests fast; the format and logic are identical.
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const hasher = createPasswordHasher({ params: FAST });

describe("passwordHasher", () => {
  it("produces a self-describing scrypt hash with a random salt", async () => {
    const a = await hasher.hash("correct horse battery");
    const b = await hasher.hash("correct horse battery");

    expect(a).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
  });

  it("verifies the right password and rejects others", async () => {
    const encoded = await hasher.hash("correct horse battery");

    expect(await hasher.verify("correct horse battery", encoded)).toBe(true);
    expect(await hasher.verify("correct horse batter", encoded)).toBe(false);
    expect(await hasher.verify("", encoded)).toBe(false);
  });

  it.each(["", "plain-text", "$2b$10$legacybcrypt", "scrypt$1024$8$1$", undefined])(
    "never matches a malformed stored hash (%j)",
    async (encoded) => {
      expect(await hasher.verify("anything", encoded)).toBe(false);
    },
  );

  it("verifies hashes made with other parameters (they travel with the hash)", async () => {
    const legacy = await createPasswordHasher({ params: { N: 2 ** 9, r: 8, p: 1 } }).hash("pw-12345678");

    expect(await hasher.verify("pw-12345678", legacy)).toBe(true);
  });

  it("asks for a rehash when stored parameters are weaker than current ones", async () => {
    const weak = await createPasswordHasher({ params: { N: 2 ** 9, r: 8, p: 1 } }).hash("pw-12345678");

    expect(hasher.needsRehash(weak)).toBe(true);
    expect(hasher.needsRehash(await hasher.hash("pw-12345678"))).toBe(false);
    expect(hasher.needsRehash("garbage")).toBe(true);
  });

  it("always fails a dummy verification", async () => {
    expect(await hasher.verifyAgainstDummy("whatever")).toBe(false);
  });

  it("uses strong defaults in production (N = 2^15)", async () => {
    expect(await createPasswordHasher().hash("x")).toMatch(/^scrypt\$32768\$8\$1\$/);
  });
});
