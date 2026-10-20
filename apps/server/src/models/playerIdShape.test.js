import { describe, expect, it } from "vitest";
import { BOT_CHARACTERS } from "@classicade/shared";
import { hasPlayerIdShape, PLAYER_ID_PREFIXES } from "./playerIdShape.js";

describe("hasPlayerIdShape (CC-253, CC-304)", () => {
  it.each([
    "guest_00000000-0000-4000-8000-000000000001",
    "user_65f1a2b3c4d5e6f708192a3b",
    "bot_rocky_easy",
    "bot_queen-vee_hard",
    "deleted_00000000-0000-4000-8000-0000000000dd",
  ])("knows %s for a player id", (id) => {
    expect(hasPlayerIdShape(id)).toBe(true);
  });

  it("knows every computer character at every level for a player id", () => {
    const ids = BOT_CHARACTERS.flatMap((character) =>
      character.levels.map((level) => `bot_${character.id}_${level.id}`),
    );

    expect(ids.filter((id) => !hasPlayerIdShape(id))).toEqual([]);
  });

  it.each(["", "rock", "e4", "Guest-1234", "AXz-9RQxFk7LuFRI7M8GNg", "a user_x", 7, undefined, null])(
    "knows %s for something else",
    (value) => {
      expect(hasPlayerIdShape(value)).toBe(false);
    },
  );

  it.each([
    "user_bob",
    "guest_x",
    "bot_bob",
    "bot_rocky_impossible",
    "bot_rocky_easy_2",
    "deleted_bob",
    "user_65f1a2b3c4d5e6f708192a3",
    "user_65F1A2B3C4D5E6F708192A3B",
    "user_65f1a2b3c4d5e6f708192a3b ",
    "deleted_00000000-0000-4000-8000-0000000000dd-",
    "deleted_000000000000-4000-8000-0000-0000000000dd",
  ])("knows %s, which only starts like a player id, for a name", (value) => {
    expect(hasPlayerIdShape(value)).toBe(false);
  });

  it("lists the four id prefixes", () => {
    expect(PLAYER_ID_PREFIXES).toEqual(["guest_", "user_", "bot_", "deleted_"]);
  });
});
