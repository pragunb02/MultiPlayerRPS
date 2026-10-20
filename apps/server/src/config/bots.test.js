import { describe, expect, it } from "vitest";
import { botThinkingSettings, MAX_THINKING_WORKERS, THINKING_BUDGET_MS } from "./bots.js";

describe("botThinkingSettings", () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [5, 4],
    [14, MAX_THINKING_WORKERS],
  ])("gives %i cores %i thinking threads, leaving one for the event loop", (parallelism, workers) => {
    expect(botThinkingSettings({ parallelism })).toEqual({ workers, budgetMs: THINKING_BUDGET_MS });
  });

  it.each([0, Number.NaN, 2.5, undefined])("still gives one thread for a reading of %s", (parallelism) => {
    expect(botThinkingSettings({ parallelism }).workers).toBe(1);
  });

  it("is frozen, with a budget far above a Strong search on 0.1 CPU", () => {
    const settings = botThinkingSettings({ parallelism: 1 });

    expect(Object.isFrozen(settings)).toBe(true);
    expect(settings.budgetMs).toBe(30_000);
  });
});
