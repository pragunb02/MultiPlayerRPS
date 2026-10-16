import { describe, expect, it } from "vitest";
import { ValidationError } from "../utils/errors.js";
import { parseRoomCode } from "./roomCode.js";

describe("parseRoomCode", () => {
  it.each([
    ["AB2CD3", "AB2CD3"],
    ["ab2cd3", "AB2CD3"],
    ["  AB2CD3 ", "AB2CD3"],
  ])("accepts and normalises %j", (raw, expected) => {
    expect(parseRoomCode(raw)).toBe(expected);
  });

  it.each(["", "AB2CD", "AB2CD34", "AB0CD3", "ABOCD3", "AB1CD3", "AB-CD3", 123456, undefined, null, { code: "AB2CD3" }])(
    "rejects %j",
    (raw) => {
      expect(() => parseRoomCode(raw)).toThrow(ValidationError);
    },
  );
});
