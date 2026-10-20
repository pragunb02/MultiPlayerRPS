import { describe, expect, it } from "vitest";
import { aged, estimates, GLICKO2, rate } from "./glicko2.js";

// The worked example in Glickman's "Example of the Glicko-2 system" (glicko.net/glicko/glicko2.pdf, 2022): a 1500
// player with RD 200 and volatility 0.06 beats a 1400 player and loses to a 1550 and a 1700 player. The paper rounds
// every value it prints to four digits and works on with the rounded values, so its Δ (−0.4834) and its rating
// (1464.06) differ from the exact ones (−0.48393 and 1464.051) in the fourth digit. The checks below hold to the
// precision the paper prints.
const PLAYER = Object.freeze({ rating: 1500, deviation: 200, volatility: 0.06 });
const GAMES = Object.freeze([
  { opponent: { rating: 1400, deviation: 30 }, score: 1 },
  { opponent: { rating: 1550, deviation: 100 }, score: 0 },
  { opponent: { rating: 1700, deviation: 300 }, score: 0 },
]);

describe("Glicko-2", () => {
  it("starts an unrated player at Glickman's defaults", () => {
    expect(GLICKO2.START).toEqual({ rating: 1500, deviation: 350, volatility: 0.06 });
    expect(GLICKO2.TAU).toBe(0.5);
  });

  it("estimates the variance and the improvement of the paper's example", () => {
    const { variance, improvement } = estimates({ player: PLAYER, games: GAMES });

    expect(variance).toBeCloseTo(1.7785, 3);
    expect(improvement).toBeCloseTo(-0.4834, 2);
  });

  it("rates the paper's example to 1464.06, RD 151.52 and volatility 0.05999", () => {
    const after = rate({ player: PLAYER, games: GAMES });

    expect(after.rating).toBeCloseTo(1464.06, 1);
    expect(after.deviation).toBeCloseTo(151.52, 2);
    expect(after.volatility).toBeCloseTo(0.05999, 4);
  });

  it("only widens the deviation of a player with no game in the period", () => {
    const after = rate({ player: PLAYER, games: [] });

    expect(after.rating).toBe(1500);
    expect(after.volatility).toBe(0.06);
    expect(after.deviation).toBeCloseTo(Math.sqrt(200 ** 2 + (0.06 * GLICKO2.SCALE) ** 2), 9);
  });

  it("raises a winner and lowers a loser by the same amount when both start equal", () => {
    const start = GLICKO2.START;
    const opponent = { rating: start.rating, deviation: start.deviation };

    const won = rate({ player: start, games: [{ opponent, score: 1 }] });
    const lost = rate({ player: start, games: [{ opponent, score: 0 }] });

    expect(won.rating).toBeGreaterThan(1500);
    expect(won.rating - 1500).toBeCloseTo(1500 - lost.rating, 9);
    expect(won.deviation).toBeLessThan(350);
  });

  it("leaves equal players where they are after a draw", () => {
    const opponent = { rating: 1500, deviation: 80 };

    const after = rate({
      player: { rating: 1500, deviation: 80, volatility: 0.06 },
      games: [{ opponent, score: 0.5 }],
    });

    expect(after.rating).toBeCloseTo(1500, 9);
  });

  it("brackets the new volatility from below when the result is no surprise", () => {
    // A strong favourite who wins: Δ² is smaller than φ² + v, so the bracket search of step 5.2 runs.
    const after = rate({
      player: { rating: 2000, deviation: 50, volatility: 0.06 },
      games: [{ opponent: { rating: 1200, deviation: 50 }, score: 1 }],
    });

    expect(after.volatility).toBeLessThan(0.06);
    expect(after.rating).toBeGreaterThan(2000);
  });

  it("raises the volatility after a big surprise", () => {
    const after = rate({
      player: { rating: 1200, deviation: 50, volatility: 0.06 },
      games: [{ opponent: { rating: 2200, deviation: 50 }, score: 1 }],
    });

    expect(after.volatility).toBeGreaterThan(0.06);
  });

  it("refuses a score other than a win, a draw or a loss", () => {
    expect(() =>
      rate({ player: PLAYER, games: [{ opponent: { rating: 1500, deviation: 50 }, score: 2 }] }),
    ).toThrow(RangeError);
  });

  it("widens the deviation with the periods since the last game, never past the start", () => {
    const player = { rating: 1700, deviation: 60, volatility: 0.06 };

    const year = aged({ player, periods: 365 * GLICKO2.PERIODS_PER_DAY });
    const forever = aged({ player, periods: 1_000_000 });

    expect(year.deviation).toBeGreaterThan(100);
    expect(year.deviation).toBeLessThan(120);
    expect(year.rating).toBe(1700);
    expect(forever.deviation).toBe(350);
    expect(aged({ player, periods: 0 })).toEqual(player);
  });

  it("refuses a negative number of periods", () => {
    expect(() => aged({ player: PLAYER, periods: -1 })).toThrow(RangeError);
  });
});
