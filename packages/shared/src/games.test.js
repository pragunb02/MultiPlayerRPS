import { describe, expect, it } from "vitest";
import { GAME_IDS, GAMES, getGame } from "./index.js";

describe("games catalog", () => {
  it("has one entry per game id, with unique ids", () => {
    const ids = GAMES.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(Object.values(GAME_IDS).sort());
  });

  it("looks games up by id", () => {
    expect(getGame(GAME_IDS.CHESS)?.name).toBe("Chess");
    expect(getGame("unknown")).toBeUndefined();
  });

  it("is immutable", () => {
    expect(() => {
      GAMES[0].name = "changed";
    }).toThrow(TypeError);
  });
});
