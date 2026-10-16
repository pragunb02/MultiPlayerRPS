import { describe, expect, it } from "vitest";
import { parseUsername } from "./credentials.js";
import { normaliseLegacyUsername, usernameCandidates } from "./legacyUsername.js";

describe("normaliseLegacyUsername", () => {
  it.each([
    ["riya_42", "riya_42"],
    ["Riya Sharma", "Riya_Sharma"],
    ["  j@ne.d0e!! ", "j_ne_d0e"],
    ["Zoë", "Zoe"],
    ["a", "a_player"],
    ["!!", "_player"],
    ["x".repeat(30), "x".repeat(20)],
  ])("%j → %j", (raw, expected) => {
    expect(normaliseLegacyUsername(raw)).toBe(expected);
  });

  it("always produces a username today's rules accept", () => {
    for (const raw of ["", " ", "😀😀😀", "ab", "a b c d e f g h i j k l m n", "名前", null, undefined, 12345]) {
      expect(() => parseUsername(normaliseLegacyUsername(raw))).not.toThrow();
    }
  });
});

describe("usernameCandidates", () => {
  it("adds numbered suffixes and stays within 20 characters", () => {
    expect(usernameCandidates("riya", 3)).toEqual(["riya", "riya_2", "riya_3"]);
    expect(usernameCandidates("x".repeat(20), 2)).toEqual(["x".repeat(20), `${"x".repeat(18)}_2`]);
  });
});
