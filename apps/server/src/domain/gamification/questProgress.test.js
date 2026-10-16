import { describe, expect, it } from "vitest";
import { QUESTS } from "@classicade/shared";
import { applyMatchToQuests, newQuestDay } from "./questProgress.js";

const ms = (iso) => Date.parse(iso);

describe("quest progress", () => {
  const AT = ms("2026-10-16T12:00:00Z");
  /** A day holding exactly the given catalog quests. */
  const dayWith = (...ids) => ({
    ...newQuestDay({ playerId: "guest_a", day: "2026-10-16" }),
    items: ids.map((id) => {
      const { name, description, counts, gameId, target, bonusXp } = QUESTS.find((q) => q.id === id);
      return {
        id,
        name,
        description,
        counts,
        gameId,
        target,
        bonusXp,
        progress: 0,
        completedAt: null,
        seenGames: [],
        run: 0,
      };
    }),
  });
  const play = (questDay, ...matches) =>
    matches.reduce(
      (day, [gameId, result], i) => applyMatchToQuests(day, { gameId, result, at: AT + i }),
      questDay,
    );
  const progressOf = (questDay) => questDay.items.map((item) => item.progress);

  it("starts the day with the selected quests, untouched", () => {
    const questDay = newQuestDay({ playerId: "guest_a", day: "2026-10-16" });

    expect(questDay).toEqual(
      expect.objectContaining({ playerId: "guest_a", day: "2026-10-16", sweepAt: null }),
    );
    expect(questDay.items.map((item) => [item.id, item.progress, item.completedAt])).toEqual([
      ["play-3", 0, null],
      ["win-1", 0, null],
      ["rps-win-2", 0, null],
    ]);
    expect(Object.isFrozen(questDay.items[0])).toBe(true);
  });

  it("counts finished matches for play quests, but not your own forfeit", () => {
    const after = play(dayWith("play-3"), ["rps", "loss"], ["rps", "forfeit"], ["chess", "draw"]);

    expect(progressOf(after)).toEqual([2]);
  });

  it("counts only wins for win quests", () => {
    expect(progressOf(play(dayWith("win-3"), ["rps", "win"], ["rps", "draw"], ["rps", "loss"]))).toEqual([1]);
  });

  it("counts only the quest's own game when it names one", () => {
    const after = play(dayWith("rps-win-2", "chess-play-1"), ["chess", "win"], ["rps", "win"]);

    expect(progressOf(after)).toEqual([1, 1]);
  });

  it("counts different games for variety, once each, and not your own forfeit", () => {
    const after = play(dayWith("variety-2"), ["rps", "win"], ["rps", "loss"], ["chess", "forfeit"]);
    expect(progressOf(after)).toEqual([1]);

    expect(progressOf(play(after, ["chess", "loss"]))).toEqual([2]);
  });

  it("counts a run of wins: a draw keeps it, a loss or forfeit ends it, the best run stays", () => {
    const day = dayWith("win-row-2");

    expect(progressOf(play(day, ["rps", "win"], ["rps", "draw"]))).toEqual([1]);
    expect(play(day, ["rps", "win"], ["rps", "draw"], ["rps", "win"]).items[0].completedAt).not.toBeNull();
    expect(play(day, ["rps", "win"], ["rps", "loss"], ["rps", "win"]).items[0]).toEqual(
      expect.objectContaining({ progress: 1, run: 1, completedAt: null }),
    );
    expect(play(day, ["rps", "win"], ["rps", "forfeit"]).items[0].run).toBe(0);
  });

  it("completes a quest at its target, at the match's time, and never goes past it", () => {
    const after = play(dayWith("win-1"), ["rps", "win"], ["rps", "win"]);

    expect(after.items[0]).toEqual(expect.objectContaining({ progress: 1, completedAt: AT }));
  });

  it("completes the daily sweep when the last quest is done, once", () => {
    const day = dayWith("win-1", "chess-play-1");
    const one = play(day, ["rps", "win"]);
    expect(one.sweepAt).toBeNull();

    const both = applyMatchToQuests(one, { gameId: "chess", result: "loss", at: AT + 10 });
    const later = applyMatchToQuests(both, { gameId: "chess", result: "win", at: AT + 20 });

    expect(both.sweepAt).toBe(AT + 10);
    expect(later.sweepAt).toBe(AT + 10);
  });

  it("refuses a snapshot it doesn't understand", () => {
    const day = { ...dayWith("win-1"), items: [{ ...dayWith("win-1").items[0], counts: "dance" }] };

    expect(() => applyMatchToQuests(day, { gameId: "rps", result: "win", at: AT })).toThrow(RangeError);
  });
});
