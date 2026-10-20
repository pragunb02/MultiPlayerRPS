import { describe, expect, it } from "vitest";
import { AVATAR_UNLOCKS, AVATARS, getAvatar, isAvatarId } from "./avatars.js";
import {
  DEFAULT_PROFILE_VISIBILITY,
  isProfileHandle,
  PROFILE_HANDLE_ALPHABET,
  PROFILE_HANDLE_LENGTH,
  PROFILE_VISIBILITY,
} from "./profiles.js";

describe("the avatar catalogue", () => {
  it("has twelve avatars, each with a unique permanent id and a name", () => {
    expect(AVATARS).toHaveLength(12);
    expect(new Set(AVATARS.map((avatar) => avatar.id)).size).toBe(AVATARS.length);
    for (const avatar of AVATARS) {
      expect(avatar.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(avatar.name.length).toBeGreaterThan(0);
    }
  });

  it("gives every avatar an unlock rule of a known kind, free for now", () => {
    const kinds = new Set(Object.values(AVATAR_UNLOCKS));
    for (const avatar of AVATARS) {
      expect(kinds.has(avatar.unlock.kind)).toBe(true);
    }
    expect(AVATARS.every((avatar) => avatar.unlock.kind === AVATAR_UNLOCKS.FREE)).toBe(true);
  });

  it("is frozen all the way down", () => {
    expect(Object.isFrozen(AVATARS)).toBe(true);
    expect(AVATARS.every((avatar) => Object.isFrozen(avatar) && Object.isFrozen(avatar.unlock))).toBe(true);
    expect(Object.isFrozen(AVATAR_UNLOCKS)).toBe(true);
  });

  it("finds an avatar by id and nothing for anything else", () => {
    expect(getAvatar("rocket")?.name).toBe("Rocket");
    expect(isAvatarId("rocket")).toBe(true);
    for (const other of ["Rocket", "", "toString", "__proto__", 7, undefined, null, {}]) {
      expect(isAvatarId(other)).toBe(false);
    }
  });
});

describe("profile handles and visibility", () => {
  it("starts every profile private", () => {
    expect(DEFAULT_PROFILE_VISIBILITY).toBe(PROFILE_VISIBILITY.PRIVATE);
    expect(Object.isFrozen(PROFILE_VISIBILITY)).toBe(true);
  });

  it("uses 32 letters without the ones people confuse", () => {
    expect(new Set(PROFILE_HANDLE_ALPHABET).size).toBe(32);
    expect(PROFILE_HANDLE_ALPHABET).not.toMatch(/[ilou]/);
  });

  it("accepts only 16 letters of the alphabet", () => {
    expect(isProfileHandle("0123456789abcdef")).toBe(true);
    expect(isProfileHandle("a".repeat(PROFILE_HANDLE_LENGTH))).toBe(true);
    for (const other of [
      "a".repeat(15),
      "a".repeat(17),
      "0123456789ABCDEF",
      "0123456789abcdei",
      "user_0123456789a",
      "guest_0123456789",
      undefined,
      16,
    ]) {
      expect(isProfileHandle(other)).toBe(false);
    }
  });
});
