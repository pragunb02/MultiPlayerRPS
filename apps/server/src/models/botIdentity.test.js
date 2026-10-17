import { describe, expect, it } from "vitest";
import { BOT_CHARACTERS, GAME_IDS } from "@classicade/shared";
import { ValidationError } from "../utils/errors.js";
import { botIdentity, isBotPlayerId, opponentKey } from "./botIdentity.js";

describe("botIdentity", () => {
  it("names one character at one level, labelled as a computer player", () => {
    const rocky = botIdentity({ gameId: GAME_IDS.RPS, level: "easy" });

    expect(rocky).toEqual({
      kind: "bot",
      id: "bot_rocky_easy",
      displayName: "Rocky",
      bot: { character: "rocky", level: "easy" },
    });
    expect(Object.isFrozen(rocky)).toBe(true);
    expect(Object.isFrozen(rocky.bot)).toBe(true);
  });

  it("gives every character and level its own stable id", () => {
    const ids = BOT_CHARACTERS.flatMap((character) =>
      character.levels.map((level) => botIdentity({ gameId: character.gameId, level: level.id }).id),
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(botIdentity({ gameId: GAME_IDS.CHESS, level: "hard" }).id).toBe("bot_queen-vee_hard");
  });

  it("refuses a game without a character", () => {
    expect(() => botIdentity({ gameId: "ludo", level: "easy" })).toThrow(ValidationError);
  });

  it("refuses a level the character does not have", () => {
    expect(() => botIdentity({ gameId: GAME_IDS.RPS, level: "medium" })).toThrow(ValidationError);
  });
});

describe("opponentKey", () => {
  it("counts every level of a character as the same opponent", () => {
    expect(opponentKey("bot_rocky_easy")).toBe("bot_rocky");
    expect(opponentKey("bot_rocky_hard")).toBe("bot_rocky");
    expect(opponentKey("bot_queen-vee_easy")).toBe("bot_queen-vee");
  });

  it("leaves a person as they are", () => {
    expect(opponentKey("guest_00000000-0000-4000-8000-000000000001")).toBe(
      "guest_00000000-0000-4000-8000-000000000001",
    );
    expect(opponentKey("user_aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("user_aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("tells computer players from people", () => {
    expect(isBotPlayerId("bot_pip_easy")).toBe(true);
    expect(isBotPlayerId("guest_a")).toBe(false);
  });
});
