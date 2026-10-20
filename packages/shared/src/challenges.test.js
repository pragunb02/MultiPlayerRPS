import { describe, expect, it } from "vitest";
import {
  CHALLENGE_ID_LENGTH,
  CHALLENGE_LIFETIME_MS,
  CHALLENGE_LIMITS,
  CHALLENGE_STATES,
  isChallengeId,
} from "./challenges.js";
import { isProfileHandle, PROFILE_HANDLE_LENGTH } from "./profiles.js";

describe("challenge ids", () => {
  it("accept 20 letters of the handle alphabet and nothing else", () => {
    expect(isChallengeId("0123456789abcdefghjk")).toBe(true);
    for (const other of [
      "0123456789abcdefghj",
      "0123456789abcdefghjkm",
      "0123456789abcdefghjI",
      "0123456789abcdefghjl",
      "user_0123456789abcdef01234567",
      "AB2CD3",
      "",
      undefined,
      20,
    ]) {
      expect(isChallengeId(other)).toBe(false);
    }
  });

  it("can never be taken for a profile handle", () => {
    expect(CHALLENGE_ID_LENGTH).not.toBe(PROFILE_HANDLE_LENGTH);
    expect(isProfileHandle("0123456789abcdefghjk")).toBe(false);
  });
});

describe("challenge rules", () => {
  it("last a day, at most 3 open per sender and one in 10 minutes to the same person", () => {
    expect(CHALLENGE_LIFETIME_MS).toBe(86_400_000);
    expect(CHALLENGE_LIMITS).toEqual({ openPerSender: 3, samePersonEveryMs: 600_000 });
    expect(Object.values(CHALLENGE_STATES).sort()).toEqual([
      "accepted",
      "declined",
      "expired",
      "open",
      "withdrawn",
    ]);
  });
});
