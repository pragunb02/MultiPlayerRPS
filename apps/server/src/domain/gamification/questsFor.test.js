import { describe, expect, it } from "vitest";
import { QUESTS } from "@classicade/shared";
import { fnv1a32, mulberry32Step, questsFor } from "./questsFor.js";

describe("questsFor (deterministic daily selection)", () => {
  it("hashes with FNV-1a 32 (published test vectors)", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("steps mulberry32 to another 32-bit state", () => {
    const next = mulberry32Step(1);

    expect(Number.isInteger(next) && next >= 0 && next < 2 ** 32).toBe(true);
    expect(mulberry32Step(1)).toBe(next);
    expect(mulberry32Step(2)).not.toBe(next);
  });

  it.each([
    ["guest_a", "2026-10-16", ["play-3", "win-1", "rps-win-2"]],
    ["guest_a", "2026-10-17", ["play-5", "win-1", "rps-play-3"]],
    ["user_652f1c2e9b1e8a3d4c5b6a79", "2026-10-16", ["variety-2", "win-1", "tictactoe-win-2"]],
    ["guest_00000000-0000-4000-8000-000000000001", "2026-10-16", ["variety-2", "win-1", "chess-play-1"]],
  ])("%s on %s gets %o", (playerId, day, expected) => {
    expect(questsFor({ playerId, day }).map((q) => q.id)).toEqual(expected);
  });

  it("picks one quest per slot, in the order play, win, game", () => {
    expect(questsFor({ playerId: "guest_z", day: "2026-01-01" }).map((q) => q.slot)).toEqual([
      "play",
      "win",
      "game",
    ]);
  });

  it("uses every quest of the catalog across players", () => {
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      questsFor({ playerId: `guest_${i}`, day: "2026-10-16" }).forEach((q) => seen.add(q.id));
    }

    expect(seen.size).toBe(QUESTS.length);
  });
});
