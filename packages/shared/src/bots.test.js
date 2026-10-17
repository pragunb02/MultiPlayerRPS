import { describe, expect, it } from "vitest";
import {
  BOT_CHARACTERS,
  BOT_DAILY_XP,
  BOT_ID_PREFIX,
  characterForGame,
  GAMES,
  isBotPlayerId,
} from "./index.js";

describe("BOT_CHARACTERS", () => {
  it("has one character for every game, named for players", () => {
    expect(BOT_CHARACTERS.map((character) => character.gameId)).toEqual(GAMES.map((game) => game.id));
    expect(BOT_CHARACTERS.map((character) => character.name)).toEqual(["Rocky", "Pip", "Queen Vee"]);
  });

  it("is frozen all the way down", () => {
    expect(Object.isFrozen(BOT_CHARACTERS)).toBe(true);
    for (const character of BOT_CHARACTERS) {
      expect(Object.isFrozen(character)).toBe(true);
      expect(Object.isFrozen(character.levels)).toBe(true);
      character.levels.forEach((level) => expect(Object.isFrozen(level)).toBe(true));
    }
  });

  it("gives each character unique level picks from easy to hard, the first being the default", () => {
    for (const character of BOT_CHARACTERS) {
      const ids = character.levels.map((level) => level.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[0]).toBe("easy");
      expect(ids.at(-1)).toBe("hard");
      expect(ids.every((id) => ["easy", "medium", "hard"].includes(id))).toBe(true);
    }
  });

  it("uses ids that fit a computer player's id", () => {
    for (const character of BOT_CHARACTERS) {
      expect(character.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe("characterForGame", () => {
  it("finds a game's character, and no character for an unknown game", () => {
    expect(characterForGame("tictactoe").name).toBe("Pip");
    expect(characterForGame("ludo")).toBeUndefined();
  });
});

describe("isBotPlayerId", () => {
  it.each([
    ["bot_rocky_easy", true],
    [`${BOT_ID_PREFIX}pip_hard`, true],
    ["guest_00000000-0000-4000-8000-000000000001", false],
    ["user_aaaaaaaaaaaaaaaaaaaaaaaa", false],
    ["robot_x", false],
    [undefined, false],
  ])("%s → %s", (id, expected) => {
    expect(isBotPlayerId(id)).toBe(expected);
  });
});

describe("BOT_DAILY_XP", () => {
  it("is the 100 XP a day ADR-025 allows from computer games", () => {
    expect(BOT_DAILY_XP).toBe(100);
  });
});
