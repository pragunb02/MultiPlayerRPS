import { describe, expect, it } from "vitest";
import { AVATARS } from "@classicade/shared";
import { canPickAvatar } from "./avatarRules.js";

const entry = (fields) => () => Object.freeze({ id: "x", name: "X", unlock: { kind: "free" }, ...fields });

describe("canPickAvatar (CC-034)", () => {
  it("lets anyone pick every free avatar of the catalogue", () => {
    expect(AVATARS.every((avatar) => canPickAvatar(avatar.id))).toBe(true);
  });

  it("refuses anything that is not an avatar id", () => {
    for (const other of ["unknown", "", "__proto__", 3, undefined, { id: "owl" }]) {
      expect(canPickAvatar(other)).toBe(false);
    }
  });

  it("refuses a retired avatar, which only those who have it keep", () => {
    expect(canPickAvatar("x", { find: entry({ retired: true }) })).toBe(false);
  });

  it("refuses an avatar whose unlock kind has no check yet, such as coins before CC-143", () => {
    expect(canPickAvatar("x", { find: entry({ unlock: { kind: "coins" } }) })).toBe(false);
  });
});
