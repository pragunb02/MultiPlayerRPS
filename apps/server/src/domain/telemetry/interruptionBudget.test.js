import { describe, expect, it } from "vitest";
import { colourBudget } from "./interruptionBudget.js";

const DAY = {
  visits: 200,
  optionalShown: 80,
  visitsWithThreeOrMore: 6,
  games: 100,
  optionalDuringPlay: 4,
  blockingOptionalDuringPlay: 0,
  firstMoveP75: 9000,
  firstMoveP75Before: 8500,
  presses: 1000,
  rageAndDead: 8,
  surfaces: [],
};
const colours = (result) => Object.fromEntries(result.lines.map(({ measure, colour }) => [measure, colour]));

describe("the interruption budget (CC-313 section 5)", () => {
  // AC-10 (CC-313)
  it("colours each line by its thresholds", () => {
    expect(colours(colourBudget(DAY))).toEqual({
      optional_per_visit: "green",
      visits_with_three_or_more: "green",
      optional_per_game_during_play: "green",
      blocking_optional_during_play: "green",
      first_move_p75_slower: "green",
      rage_and_dead_per_100_presses: "green",
    });

    expect(
      colours(
        colourBudget({
          ...DAY,
          optionalShown: 150,
          visitsWithThreeOrMore: 16,
          optionalDuringPlay: 15,
          firstMoveP75: 10_000,
          rageAndDead: 25,
        }),
      ),
    ).toEqual({
      optional_per_visit: "amber",
      visits_with_three_or_more: "amber",
      optional_per_game_during_play: "amber",
      blocking_optional_during_play: "green",
      first_move_p75_slower: "amber",
      rage_and_dead_per_100_presses: "amber",
    });

    expect(
      colours(
        colourBudget({
          ...DAY,
          optionalShown: 201,
          visitsWithThreeOrMore: 21,
          optionalDuringPlay: 21,
          blockingOptionalDuringPlay: 5,
          firstMoveP75: 10_700,
          rageAndDead: 31,
        }),
      ),
    ).toEqual({
      optional_per_visit: "red",
      visits_with_three_or_more: "red",
      optional_per_game_during_play: "red",
      blocking_optional_during_play: "red",
      first_move_p75_slower: "red",
      rage_and_dead_per_100_presses: "red",
    });
  });

  it("gives no colour to a share of fewer than 5, nor to a line it cannot work out", () => {
    const small = colours(
      colourBudget({
        ...DAY,
        visits: 4,
        games: 0,
        blockingOptionalDuringPlay: 3,
        firstMoveP75Before: undefined,
        presses: 2,
      }),
    );

    expect(small).toEqual({
      optional_per_visit: "none",
      visits_with_three_or_more: "none",
      optional_per_game_during_play: "none",
      blocking_optional_during_play: "none",
      first_move_p75_slower: "none",
      rage_and_dead_per_100_presses: "none",
    });
  });

  it("judges a surface's dismissed and covered shares only from 50 shown", () => {
    const { surfaces } = colourBudget({
      ...DAY,
      surfaces: [
        { surface: "toast.xp", shown: 100, dismissed: 40, covered: 1 },
        { surface: "card.save_progress", shown: 100, dismissed: 60, covered: 4 },
        { surface: "request.site", shown: 100, dismissed: 71, covered: 6 },
        { surface: "toast.quest", shown: 49, dismissed: 49, covered: 49 },
      ],
    });

    expect(
      surfaces.map(({ surface, dismissed, covered }) => [surface, dismissed.colour, covered.colour]),
    ).toEqual([
      ["toast.xp", "green", "green"],
      ["card.save_progress", "amber", "amber"],
      ["request.site", "red", "red"],
      ["toast.quest", "none", "none"],
    ]);
    expect(surfaces[1].dismissed.value).toBeCloseTo(0.6);
  });
});
