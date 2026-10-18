import { DELETED_PLAYER_NAME } from "@classicade/shared";
import { describe, expect, it } from "vitest";
import { deletedPlayer, earnsNothing, isDeletedPlayerId } from "./deletedPlayer.js";

describe("deletedPlayer", () => {
  it("makes an anonymous stand-in with its own id and the deleted player's name", () => {
    const stand = deletedPlayer("00000000-0000-4000-8000-000000000001");

    expect(stand).toEqual({
      id: "deleted_00000000-0000-4000-8000-000000000001",
      displayName: DELETED_PLAYER_NAME,
    });
    expect(Object.isFrozen(stand)).toBe(true);
    expect(isDeletedPlayerId(stand.id)).toBe(true);
  });

  it("tells stand-ins apart from people and computer characters", () => {
    expect(isDeletedPlayerId("guest_00000000-0000-4000-8000-000000000001")).toBe(false);
    expect(isDeletedPlayerId("user_0123456789abcdef01234567")).toBe(false);
  });

  it("lets neither a stand-in nor a computer character earn anything", () => {
    expect(earnsNothing("deleted_00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(earnsNothing("bot_rocky_easy")).toBe(true);
    expect(earnsNothing("guest_00000000-0000-4000-8000-000000000001")).toBe(false);
    expect(earnsNothing("user_0123456789abcdef01234567")).toBe(false);
  });
});
