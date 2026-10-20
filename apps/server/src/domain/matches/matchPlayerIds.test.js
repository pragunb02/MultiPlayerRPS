import { describe, expect, it } from "vitest";
import { createSeatIds, seatSecretFrom } from "../rooms/seatIds.js";
import { createMatchPlayerIds, matchPlayerSecretFrom } from "./matchPlayerIds.js";

const SECRET = "match-secret-for-tests-only-0123456789abcdef";
const MATCH = Object.freeze({ matchId: "00000000-0000-4000-8000-0000000000aa" });
const OTHER_MATCH = Object.freeze({ matchId: "00000000-0000-4000-8000-0000000000bb" });
const ACCOUNT = "user_65f1a2b3c4d5e6f708192a3b";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";

describe("match player ids (CC-297)", () => {
  it("names a player in a match by 22 base64url characters", () => {
    expect(createMatchPlayerIds({ secret: SECRET }).playerIdIn(MATCH, ACCOUNT)).toMatch(
      /^[A-Za-z0-9_-]{22}$/,
    );
  });

  it("gives a player the same id on every read of the same match, whoever reads it", () => {
    const ids = createMatchPlayerIds({ secret: SECRET });

    expect(createMatchPlayerIds({ secret: SECRET }).playerIdIn({ ...MATCH }, ACCOUNT)).toBe(
      ids.playerIdIn(MATCH, ACCOUNT),
    );
  });

  it("gives two players of one match different ids", () => {
    const ids = createMatchPlayerIds({ secret: SECRET });

    expect(ids.playerIdIn(MATCH, ACCOUNT)).not.toBe(ids.playerIdIn(MATCH, GUEST));
  });

  it("gives the same player an unrelated id in another match, so matches cannot be linked by it", () => {
    const ids = createMatchPlayerIds({ secret: SECRET });

    expect(ids.playerIdIn(OTHER_MATCH, ACCOUNT)).not.toBe(ids.playerIdIn(MATCH, ACCOUNT));
  });

  it("cannot be worked out from the player id or its creation time without the server's key", () => {
    const id = createMatchPlayerIds({ secret: SECRET }).playerIdIn(MATCH, ACCOUNT);

    expect(id).not.toContain(ACCOUNT.slice("user_".length, "user_".length + 8));
    expect(createMatchPlayerIds({ secret: `${SECRET}-other` }).playerIdIn(MATCH, ACCOUNT)).not.toBe(id);
  });

  it("refuses a missing or short key", () => {
    expect(() => createMatchPlayerIds({ secret: undefined })).toThrow(TypeError);
    expect(() => createMatchPlayerIds({ secret: "short" })).toThrow(RangeError);
  });

  it("uses its own key, so a player's match id never equals their seat id in the room", () => {
    const sessionSecret = "session-secret-for-tests-only-0123456789";
    const key = matchPlayerSecretFrom(sessionSecret);
    const room = { code: MATCH.matchId, createdAt: 0 };

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toBe(seatSecretFrom(sessionSecret));
    expect(createMatchPlayerIds({ secret: key }).playerIdIn(MATCH, ACCOUNT)).not.toBe(
      createSeatIds({ secret: seatSecretFrom(sessionSecret) }).seatIdOf(room, ACCOUNT),
    );
  });
});
