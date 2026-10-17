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
    for (const raw of [
      "",
      " ",
      "😀😀😀",
      "ab",
      "a b c d e f g h i j k l m n",
      "名前",
      null,
      undefined,
      12345,
    ]) {
      expect(() => parseUsername(normaliseLegacyUsername(raw))).not.toThrow();
    }
  });
});

describe("normaliseLegacyUsername with a reserved or rude old name", () => {
  it.each(["admin", "Admin!!", "Classi Cade", "Chess Bot", "fuck you", "5h1t!!", "ass"])(
    "swaps %j for a neutral player name",
    (raw) => {
      expect(normaliseLegacyUsername(raw)).toMatch(/^Player_\d{4}$/);
    },
  );

  it("gives the same old name the same neutral name every time", () => {
    expect(normaliseLegacyUsername("admin")).toBe(normaliseLegacyUsername("admin"));
    expect(normaliseLegacyUsername("admin")).not.toBe(normaliseLegacyUsername("moderator"));
  });

  it("keeps a fair old name that only looks close to a listed word", () => {
    expect(normaliseLegacyUsername("Charles Dickens")).toBe("Charles_Dickens");
    expect(normaliseLegacyUsername("Scunthorpe!")).toBe("Scunthorpe");
  });

  it("produces a neutral name that today's rules accept", () => {
    for (const raw of ["admin", "nocap gaming", "bitch", "cpu", "rps"]) {
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
