import { describe, expect, it } from "vitest";
import { isChallengeId } from "@classicade/shared";
import { hasPlayerIdShape } from "./playerIdShape.js";
import { newChallengeId } from "./challengeId.js";

describe("newChallengeId", () => {
  it("makes a challenge id from random bytes only", () => {
    const id = newChallengeId();

    expect(isChallengeId(id)).toBe(true);
    expect(hasPlayerIdShape(id)).toBe(false);
  });

  it("uses the lowest five bits of each byte, so every letter is equally likely", () => {
    const bytes = (size) => Buffer.from(Array.from({ length: size }, (_, index) => 0b11100000 | index));

    expect(newChallengeId(bytes)).toBe("0123456789abcdefghjk");
  });

  it("is different every time", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newChallengeId()));

    expect(ids.size).toBe(200);
  });
});
