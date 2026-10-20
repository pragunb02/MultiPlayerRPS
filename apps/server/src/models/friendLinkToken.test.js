import { describe, expect, it } from "vitest";
import { isFriendLinkToken } from "@classicade/shared";
import { hashFriendLinkToken, newFriendLinkToken } from "./friendLinkToken.js";
import { hasPlayerIdShape } from "./playerIdShape.js";

describe("friend link tokens (CC-052)", () => {
  it("makes 22 base64url characters, never shaped like a player id", () => {
    for (let i = 0; i < 200; i++) {
      const token = newFriendLinkToken();
      expect(isFriendLinkToken(token)).toBe(true);
      expect(hasPlayerIdShape(token)).toBe(false);
    }
  });

  it("is a new random value each time", () => {
    expect(new Set(Array.from({ length: 500 }, () => newFriendLinkToken())).size).toBe(500);
  });

  it("writes the random bytes it is given in base64url", () => {
    expect(newFriendLinkToken((size) => Buffer.alloc(size, 0xff))).toBe("_____________________w");
  });

  it("stores a token only as its SHA-256, the same for the same token", () => {
    const token = "AbCdEfGhIjKlMnOpQrSt_-";

    expect(hashFriendLinkToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFriendLinkToken(token)).toBe(hashFriendLinkToken(token));
    expect(hashFriendLinkToken(token)).not.toContain(token);
    expect(hashFriendLinkToken(`${token.slice(0, -1)}A`)).not.toBe(hashFriendLinkToken(token));
  });
});
