import { describe, expect, it } from "vitest";
import { ValidationError } from "../utils/errors.js";
import {
  normaliseEmail,
  parseEmail,
  parsePassword,
  parseUsername,
  RESERVED_NAME,
  UNSUITABLE_NAME,
} from "./credentials.js";

const fieldOf = (fn) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return err.details.field;
  }
  throw new Error("expected a ValidationError");
};

describe("credentials", () => {
  it.each(["riya_42", "Bob", "x".repeat(20)])("accepts username %j", (raw) => {
    expect(parseUsername(raw)).toBe(raw);
  });

  it.each(["ab", "x".repeat(21), "has space", "emoji😀", "a-b", 42, undefined])(
    "rejects username %j",
    (raw) => {
      expect(fieldOf(() => parseUsername(raw))).toBe("username");
    },
  );

  it.each(["Admin_1", "ClassiCade", "ChessBot", "Tic_Tac_Toe"])(
    "refuses the reserved username %j kindly",
    (raw) => {
      expect(() => parseUsername(raw)).toThrow(RESERVED_NAME);
      expect(fieldOf(() => parseUsername(raw))).toBe("username");
    },
  );

  it.each(["fuuuck", "5h1t", "Big_Ass"])("refuses the rude username %j without naming the word", (raw) => {
    expect(() => parseUsername(raw)).toThrow(UNSUITABLE_NAME);
    expect(fieldOf(() => parseUsername(raw))).toBe("username");
  });

  it.each(["Scunthorpe", "Dickens", "Assassin", "classic_fan"])("accepts the fair username %j", (raw) => {
    expect(parseUsername(raw)).toBe(raw);
  });

  it("never repeats a listed word in the refusal", () => {
    for (const message of [RESERVED_NAME, UNSUITABLE_NAME]) {
      expect(message.toLowerCase()).not.toMatch(/admin|bot|fuck|shit|\bass\b/);
    }
  });

  it("normalises email", () => {
    expect(parseEmail("  Riya@Example.COM ")).toBe("riya@example.com");
  });

  it.each(["no-at-sign", "a@b", "a b@c.de", `${"x".repeat(250)}@a.co`, null])("rejects email %j", (raw) => {
    expect(fieldOf(() => parseEmail(raw))).toBe("email");
  });

  // One person, one account: spellings of the same address that look the same are stored the same (CC-245).
  it.each([
    ["an accent typed as one character or as two", "jose\u0301@example.com", "jos\u00e9@example.com"],
    ["full-width letters from a phone keyboard", "\uff32\uff49\uff59\uff41@example.com", "riya@example.com"],
    ["a full-width at sign", "riya\uff20example.com", "riya@example.com"],
    ["a wide space around it", "\u3000riya@example.com\u3000", "riya@example.com"],
    ["capitals outside the Latin alphabet", "\u0394\u0399\u0391@example.gr", "\u03b4\u03b9\u03b1@example.gr"],
  ])("stores %s as one email", (_, typed, stored) => {
    expect(parseEmail(typed)).toBe(stored);
    expect(parseEmail(typed)).toBe(parseEmail(stored));
  });

  it.each([
    ["a zero-width space", "riya\u200b@example.com"],
    ["a right-to-left mark", "riya\u200f@example.com"],
    ["a control character", "riya\u0007@example.com"],
  ])("refuses an email with %s, which nobody can see", (_, raw) => {
    expect(fieldOf(() => parseEmail(raw))).toBe("email");
  });

  it("does not fold Gmail dots or plus addresses, which mean different mailboxes elsewhere", () => {
    expect(parseEmail("r.iya+games@gmail.com")).toBe("r.iya+games@gmail.com");
  });

  it("normalises any text the same way as parseEmail, without checking it, for the login limits", () => {
    expect(normaliseEmail(" \uff32iya@Example.com ")).toBe("riya@example.com");
    expect(normaliseEmail("not an email")).toBe("not an email");
    expect(normaliseEmail(undefined)).toBe("");
  });

  it("keeps passwords exactly as typed", () => {
    expect(parsePassword("  spaced out  ")).toBe("  spaced out  ");
  });

  it.each(["short", "x".repeat(129), "        ", 12345678, undefined])("rejects password %j", (raw) => {
    expect(fieldOf(() => parsePassword(raw))).toBe("password");
  });
});
