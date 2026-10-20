import { describe, expect, it } from "vitest";
import { sealSecretFrom } from "../bots/seals.js";
import { createSeatIds, SEAT_ID_PATTERN, seatSecretFrom } from "./seatIds.js";

const SECRET = "seat-secret-for-tests-only-0123456789abcdef";
const ROOM = Object.freeze({ code: "ROOM22", createdAt: 1_000_000 });
const ACCOUNT = "user_65f1a2b3c4d5e6f708192a3b";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";

describe("seat ids (CC-253)", () => {
  it("names a player in a room by 22 base64url characters", () => {
    const seatIds = createSeatIds({ secret: SECRET });

    const seatId = seatIds.seatIdOf(ROOM, ACCOUNT);

    expect(seatId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(SEAT_ID_PATTERN.test(seatId)).toBe(true);
  });

  it("gives the same player the same seat id every time in the same room", () => {
    const seatIds = createSeatIds({ secret: SECRET });

    expect(seatIds.seatIdOf({ ...ROOM }, ACCOUNT)).toBe(seatIds.seatIdOf(ROOM, ACCOUNT));
    expect(createSeatIds({ secret: SECRET }).seatIdOf(ROOM, ACCOUNT)).toBe(seatIds.seatIdOf(ROOM, ACCOUNT));
  });

  it("gives two players of one room different seat ids", () => {
    const seatIds = createSeatIds({ secret: SECRET });

    expect(seatIds.seatIdOf(ROOM, ACCOUNT)).not.toBe(seatIds.seatIdOf(ROOM, GUEST));
  });

  it("gives the same player an unrelated seat id in another room, also when a code comes back later", () => {
    const seatIds = createSeatIds({ secret: SECRET });
    const here = seatIds.seatIdOf(ROOM, ACCOUNT);

    expect(seatIds.seatIdOf({ ...ROOM, code: "ROOM33" }, ACCOUNT)).not.toBe(here);
    expect(seatIds.seatIdOf({ ...ROOM, createdAt: ROOM.createdAt + 86_400_000 }, ACCOUNT)).not.toBe(here);
  });

  it("cannot be worked out from the player id, its creation time or the room without the server's key", () => {
    const seatId = createSeatIds({ secret: SECRET }).seatIdOf(ROOM, ACCOUNT);
    const accountTime = ACCOUNT.slice("user_".length, "user_".length + 8);

    expect(seatId).not.toContain(accountTime);
    expect(seatId).not.toContain(ACCOUNT.slice("user_".length));
    expect(createSeatIds({ secret: `${SECRET}-other` }).seatIdOf(ROOM, ACCOUNT)).not.toBe(seatId);
  });

  it("keeps the room code, its time and the player apart, so no two rooms can be made to give the same input", () => {
    const seatIds = createSeatIds({ secret: SECRET });

    expect(seatIds.seatIdOf({ code: "AB", createdAt: 12 }, "3x")).not.toBe(
      seatIds.seatIdOf({ code: "AB1", createdAt: 2 }, "3x"),
    );
  });

  it("refuses a missing or short key, so a wiring mistake stops the boot", () => {
    expect(() => createSeatIds({ secret: undefined })).toThrow(TypeError);
    expect(() => createSeatIds({ secret: "short" })).toThrow(RangeError);
  });

  it("derives its key from the session secret under its own label, apart from the seals' key", () => {
    const sessionSecret = "session-secret-for-tests-only-0123456789";

    const key = seatSecretFrom(sessionSecret);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toBe(sessionSecret);
    expect(key).not.toBe(sealSecretFrom(sessionSecret));
    expect(seatSecretFrom(sessionSecret)).toBe(key);
  });
});
