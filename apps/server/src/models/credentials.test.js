import { describe, expect, it } from "vitest";
import { ValidationError } from "../utils/errors.js";
import { parseEmail, parsePassword, parseUsername, RESERVED_NAME, UNSUITABLE_NAME } from "./credentials.js";

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

  it("keeps passwords exactly as typed", () => {
    expect(parsePassword("  spaced out  ")).toBe("  spaced out  ");
  });

  it.each(["short", "x".repeat(129), "        ", 12345678, undefined])("rejects password %j", (raw) => {
    expect(fieldOf(() => parsePassword(raw))).toBe("password");
  });
});
