import { describe, expect, it } from "vitest";
import { GAME_IDS, GAMES, getGame, getGameBySlug } from "./index.js";

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

  it("gives every game a unique, URL-safe slug", () => {
    const slugs = GAMES.map((game) => game.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    slugs.forEach((slug) => expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/));
    expect(getGameBySlug("tic-tac-toe")?.id).toBe(GAME_IDS.TIC_TAC_TOE);
    expect(getGameBySlug("tictactoe")).toBeUndefined();
  });

  it("is immutable", () => {
    expect(() => {
      GAMES[0].name = "changed";
    }).toThrow(TypeError);
  });
});
