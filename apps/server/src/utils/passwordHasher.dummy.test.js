import { describe, expect, it, vi } from "vitest";

// Records the parameters of every scrypt run, and runs the real one.
const runs = vi.hoisted(() => []);
vi.mock("node:crypto", async (importOriginal) => {
  const crypto = await importOriginal();
  return {
    ...crypto,
    scrypt: (password, salt, keyLength, options, done) => {
      runs.push({ N: options.N, r: options.r, p: options.p });
      return crypto.scrypt(password, salt, keyLength, options, done);
    },
  };
});

const { createPasswordHasher, DEFAULT_SCRYPT_PARAMS } = await import("./passwordHasher.js");

describe("passwordHasher's dummy hash (CC-260)", () => {
  it("costs what a real account's check costs: an unknown email runs scrypt with the production parameters", async () => {
    const hasher = createPasswordHasher();
    await hasher.verifyAgainstDummy("warm up");
    runs.length = 0;

    await hasher.verifyAgainstDummy("someone's guess");

    expect(runs).toEqual([DEFAULT_SCRYPT_PARAMS]);
    expect(DEFAULT_SCRYPT_PARAMS.p).toBe(3);
  });
});
