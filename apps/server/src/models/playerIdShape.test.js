import { describe, expect, it } from "vitest";
import { hasPlayerIdShape } from "./playerIdShape.js";

describe("hasPlayerIdShape (CC-253)", () => {
  it.each([
    "guest_00000000-0000-4000-8000-000000000001",
    "user_65f1a2b3c4d5e6f708192a3b",
    "bot_rocky_easy",
    "deleted_00000000-0000-4000-8000-0000000000dd",
  ])("knows %s for a player id", (id) => {
    expect(hasPlayerIdShape(id)).toBe(true);
  });

  it.each(["", "rock", "e4", "Guest-1234", "AXz-9RQxFk7LuFRI7M8GNg", "a user_x", 7, undefined, null])(
    "knows %s for something else",
    (value) => {
      expect(hasPlayerIdShape(value)).toBe(false);
    },
  );
});
