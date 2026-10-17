import { GAMES } from "@classicade/shared";
import { describe, expect, it } from "vitest";
import { ENGINES } from "../engines.js";
import { raceBot } from "../testing/raceBot.js";
import { defineBot } from "./bot.js";
import { BOTS } from "./bots.js";
import { createBotRegistry } from "./registry.js";

const otherBot = defineBot({ ...raceBot, gameId: "other" });

describe("createBotRegistry", () => {
  it("looks bots up by game id", () => {
    const registry = createBotRegistry([raceBot, otherBot]);

    expect(registry.get("race")).toBe(raceBot);
    expect(registry.get("other")).toBe(otherBot);
    expect(registry.has("race")).toBe(true);
    expect(registry.has("chess")).toBe(false);
    expect(registry.gameIds()).toEqual(["race", "other"]);
  });

  it("throws for a game without a bot instead of returning nothing", () => {
    expect(() => createBotRegistry([raceBot]).get("chess")).toThrow(RangeError);
  });

  it("refuses two bots for one game", () => {
    expect(() => createBotRegistry([raceBot, raceBot])).toThrow(/Duplicate bot for game "race"/);
  });

  it("is immutable", () => {
    const registry = createBotRegistry([raceBot]);

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.gameIds())).toBe(true);
  });
});

describe("BOTS", () => {
  it("has one bot for every game in the catalog, in catalog order", () => {
    expect(createBotRegistry(BOTS).gameIds()).toEqual(GAMES.map((game) => game.id));
    expect(BOTS.map((bot) => bot.gameId)).toEqual(ENGINES.map((engine) => engine.id));
  });
});
