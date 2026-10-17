import { describe, expect, it } from "vitest";
import { BOTS, createBotRegistry } from "@classicade/games";
import { GAME_IDS } from "@classicade/shared";
import { botRooms, PERSON } from "../../testing/botRooms.js";
import { ValidationError } from "../../utils/errors.js";
import { assertCharactersPlayable, createBotComponent } from "./botComponent.js";

describe("botComponent.playComputer", () => {
  it.each([
    [GAME_IDS.RPS, "bot_rocky_easy", "Rocky"],
    [GAME_IDS.TIC_TAC_TOE, "bot_pip_easy", "Pip"],
    [GAME_IDS.CHESS, "bot_queen-vee_easy", "Queen Vee"],
  ])("starts %s at once against its character, seated as a computer player", async (gameId, id, name) => {
    const { playComputer, rooms } = botRooms();

    const room = await playComputer({ gameId });

    expect(room.status).toBe("playing");
    expect(room.hostId).toBe(PERSON.id);
    expect(rooms.viewFor(room, PERSON.id).seats).toEqual([
      { playerId: PERSON.id, displayName: "Alice", connected: true },
      {
        playerId: id,
        displayName: name,
        connected: true,
        bot: { character: id.split("_")[1], level: "easy" },
      },
    ]);
  });

  it("keeps the game's options", async () => {
    const { playComputer } = botRooms();

    const room = await playComputer({ gameId: GAME_IDS.RPS, options: { bestOf: 5 } });

    expect(room.options).toEqual({ bestOf: 5 });
  });

  it("refuses an unknown level before any room is made", async () => {
    const { playComputer, roomAccessor } = botRooms();

    await expect(playComputer({ gameId: GAME_IDS.RPS, level: "impossible" })).rejects.toThrow(
      ValidationError,
    );
    expect(await roomAccessor.listAll()).toEqual([]);
  });

  it("refuses invalid options like any new room", async () => {
    const { playComputer } = botRooms();

    await expect(playComputer({ gameId: GAME_IDS.RPS, options: { bestOf: 4 } })).rejects.toThrow(
      ValidationError,
    );
  });

  it("needs the room component", () => {
    expect(() => createBotComponent({})).toThrow(TypeError);
  });
});

describe("assertCharactersPlayable", () => {
  const bots = createBotRegistry(BOTS);

  it("accepts the catalog's characters", () => {
    expect(() => assertCharactersPlayable(bots)).not.toThrow();
  });

  it("names a character whose game has no bot, and a level its bot does not have", () => {
    const characters = [
      { id: "ludo-lu", gameId: "ludo", levels: [] },
      { id: "rocky", gameId: GAME_IDS.RPS, levels: [{ id: "hard", botLevel: "psychic" }] },
    ];

    expect(() => assertCharactersPlayable(bots, characters)).toThrow(
      "Computer characters that cannot play: ludo-lu plays ludo, which has no bot, rocky hard names the unknown bot level psychic",
    );
  });
});
