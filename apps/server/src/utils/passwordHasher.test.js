import { describe, expect, it } from "vitest";
import { createPasswordHasher, DEFAULT_SCRYPT_PARAMS } from "./passwordHasher.js";

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

  it.each([
    ["N not a power of two", "scrypt$3$8$1$c2FsdA==$aGFzaA=="],
    ["N not a number", "scrypt$lots$8$1$c2FsdA==$aGFzaA=="],
    ["N too large for memory", `scrypt$${2 ** 40}$8$1$c2FsdA==$aGFzaA==`],
    ["N of 1", "scrypt$1$8$1$c2FsdA==$aGFzaA=="],
    ["r of 0", "scrypt$1024$0$1$c2FsdA==$aGFzaA=="],
    ["r fractional", "scrypt$1024$1.5$1$c2FsdA==$aGFzaA=="],
    ["p too large", "scrypt$1024$8$17$c2FsdA==$aGFzaA=="],
  ])("never matches, and never throws, for corrupt stored parameters (%s)", async (_case, stored) => {
    expect(await hasher.verify("password123", stored)).toBe(false);
  });

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

  it("uses OWASP's alternative parameters in production, N = 2^15, r = 8, p = 3 (CC-260)", async () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ N: 2 ** 15, r: 8, p: 3 });
    expect(await createPasswordHasher().hash("x")).toMatch(/^scrypt\$32768\$8\$3\$/);
  });

  it("asks for a rehash of a hash made with the old production parameters, p = 1 (CC-260)", () => {
    const production = createPasswordHasher();

    expect(production.needsRehash("scrypt$32768$8$1$c2FsdA==$aGFzaA==")).toBe(true);
    expect(production.needsRehash("scrypt$32768$8$3$c2FsdA==$aGFzaA==")).toBe(false);
  });

  it("still verifies a hash made with the old production parameters (CC-260)", async () => {
    const old = await createPasswordHasher({ params: { N: 2 ** 15, r: 8, p: 1 } }).hash("pw-12345678");

    expect(await createPasswordHasher().verify("pw-12345678", old)).toBe(true);
  });
});
