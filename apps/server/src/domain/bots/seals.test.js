import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commitmentOf, createSealMaker, sealSecretFrom } from "./seals.js";

const SECRET = "a-test-secret-that-is-long-enough-0123456789";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

describe("commitmentOf", () => {
  it("is the SHA-256 of the text, a colon and the salt, in lowercase hexadecimal", () => {
    expect(commitmentOf({ text: '{"choice":"rock"}', salt: "abc" })).toBe(sha256('{"choice":"rock"}:abc'));
    expect(commitmentOf({ text: "", salt: "" })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("createSealMaker", () => {
  const maker = createSealMaker({ secret: SECRET });

  it("seals a move so that hashing the shown text and salt gives the lock", () => {
    const seal = maker.seal({ key: "m1:0:bot_rocky_easy", text: '{"choice":"paper"}' });

    expect(seal.text).toBe('{"choice":"paper"}');
    expect(seal.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(seal.commitment).toBe(sha256(`${seal.text}:${seal.salt}`));
    expect(Object.isFrozen(seal)).toBe(true);
  });

  it("gives the same seal when the same turn is decided again", () => {
    const again = () => maker.seal({ key: "m1:2:bot_rocky_easy", text: '{"choice":"rock"}' });

    expect(again()).toEqual(again());
  });

  it("gives every turn its own salt, so one shown salt says nothing about the next", () => {
    const first = maker.seal({ key: "m1:0:bot_rocky_easy", text: '{"choice":"rock"}' });
    const next = maker.seal({ key: "m1:2:bot_rocky_easy", text: '{"choice":"rock"}' });

    expect(next.salt).not.toBe(first.salt);
    expect(next.commitment).not.toBe(first.commitment);
  });

  it("gives a different lock for a different move, so the move cannot change after the lock", () => {
    const rock = maker.seal({ key: "m1:0:bot", text: '{"choice":"rock"}' });
    const paper = maker.seal({ key: "m1:0:bot", text: '{"choice":"paper"}' });

    expect(paper.salt).toBe(rock.salt);
    expect(paper.commitment).not.toBe(rock.commitment);
  });

  it("depends on the secret", () => {
    const other = createSealMaker({ secret: `${SECRET}!` });

    expect(other.seal({ key: "k", text: "t" }).salt).not.toBe(maker.seal({ key: "k", text: "t" }).salt);
  });

  it("refuses a missing or short secret", () => {
    expect(() => createSealMaker({})).toThrow(TypeError);
    expect(() => createSealMaker({ secret: "short" })).toThrow(RangeError);
  });
});

describe("sealSecretFrom", () => {
  it("derives a separate, stable secret from the session secret", () => {
    const derived = sealSecretFrom(SECRET);

    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).toBe(sealSecretFrom(SECRET));
    expect(derived).not.toContain(SECRET);
    expect(sealSecretFrom(`${SECRET}x`)).not.toBe(derived);
  });
});
