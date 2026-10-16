import { describe, expect, it } from "vitest";
import { ValidationError } from "../utils/errors.js";
import { parseEmail, parsePassword, parseUsername } from "./credentials.js";

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

  it.each(["ab", "x".repeat(21), "has space", "emoji😀", "a-b", 42, undefined])("rejects username %j", (raw) => {
    expect(fieldOf(() => parseUsername(raw))).toBe("username");
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
