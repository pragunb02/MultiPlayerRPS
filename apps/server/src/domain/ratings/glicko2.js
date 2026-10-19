/**
 * The Glicko-2 rating system, exactly as Mark Glickman publishes it in "Example of the Glicko-2 system"
 * (glicko.net/glicko/glicko2.pdf, revised 2022). Pure functions only: no clock, no storage. The step numbers in the
 * comments are the paper's (ADR-027, ADR-062).
 *
 * @typedef {Readonly<{ rating: number, deviation: number, volatility: number }>} Glicko   on the familiar scale
 *   (1500 for a new player). `deviation` is the RD
 * @typedef {Readonly<{ opponent: Readonly<{ rating: number, deviation: number }>, score: number }>} RatedGame
 *   `score` is 1 for a win, 0.5 for a draw and 0 for a loss
 */

export const GLICKO2 = Object.freeze({
  /** Turns the familiar scale into Glicko-2's own (step 2). */
  SCALE: 173.7178,
  /** Where an unrated player starts (step 1a). The deviation never grows past it. */
  START: Object.freeze({ rating: 1500, deviation: 350, volatility: 0.06 }),
  /** How much the volatility may change. The paper's example uses 0.5, within its advised 0.3 to 1.2. */
  TAU: 0.5,
  /** When the search for the new volatility stops (step 5). */
  TOLERANCE: 0.000001,
  /**
   * Rating periods in one day, for a player who has not played for a while. Lichess's value, chosen so that a
   * typical deviation goes from 60 to 110 in a year without games.
   */
  PERIODS_PER_DAY: 0.21436,
});

const SCORES = new Set([0, 0.5, 1]);
const g = (phi) => 1 / Math.sqrt(1 + (3 * phi ** 2) / Math.PI ** 2);
const expected = (mu, muj, phij) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
const toMu = (rating) => (rating - GLICKO2.START.rating) / GLICKO2.SCALE;
const toPhi = (deviation) => deviation / GLICKO2.SCALE;

/** The games on Glicko-2's own scale, with each game's g and expected score worked out once. */
function onOwnScale(player, games) {
  const mu = toMu(player.rating);
  return games.map(({ opponent, score }) => {
    if (!SCORES.has(score)) {
      throw new RangeError(`A game's score is 1, 0.5 or 0, not ${score}`);
    }
    const phij = toPhi(opponent.deviation);
    return { score, gj: g(phij), ej: expected(mu, toMu(opponent.rating), phij) };
  });
}

/**
 * The two estimates the period's games give (steps 3 and 4): the variance of the player's rating from the games
 * alone, and how far the games suggest the rating should move. Both on Glicko-2's own scale.
 *
 * @param {{ player: Glicko, games: ReadonlyArray<RatedGame> }} period  at least one game
 * @returns {Readonly<{ variance: number, improvement: number }>}
 */
export function estimates({ player, games }) {
  const scaled = onOwnScale(player, games);
  const variance = 1 / scaled.reduce((sum, { gj, ej }) => sum + gj ** 2 * ej * (1 - ej), 0);
  const improvement = variance * scaled.reduce((sum, { score, gj, ej }) => sum + gj * (score - ej), 0);
  return Object.freeze({ variance, improvement });
}

/** Step 5: the new volatility, by the Illinois method the paper gives. */
function newVolatility({ phi, sigma, variance, improvement, tau }) {
  const a = Math.log(sigma ** 2);
  const f = (x) =>
    (Math.exp(x) * (improvement ** 2 - phi ** 2 - variance - Math.exp(x))) /
      (2 * (phi ** 2 + variance + Math.exp(x)) ** 2) -
    (x - a) / tau ** 2;
  let A = a;
  let B;
  if (improvement ** 2 > phi ** 2 + variance) {
    B = Math.log(improvement ** 2 - phi ** 2 - variance);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > GLICKO2.TOLERANCE) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/**
 * A player's rating after one rating period. With no games only the deviation grows, as the paper says for a
 * player who did not compete.
 *
 * @param {{ player: Glicko, games: ReadonlyArray<RatedGame>, tau?: number }} period
 * @returns {Glicko}
 * @throws {RangeError} when a score is not 1, 0.5 or 0
 */
export function rate({ player, games, tau = GLICKO2.TAU }) {
  const phi = toPhi(player.deviation);
  if (games.length === 0) {
    return Object.freeze({
      ...player,
      deviation: Math.sqrt(phi ** 2 + player.volatility ** 2) * GLICKO2.SCALE,
    });
  }
  const { variance, improvement } = estimates({ player, games });
  const volatility = newVolatility({ phi, sigma: player.volatility, variance, improvement, tau });
  // Steps 6 to 8: widen by the new volatility, narrow by the games, move the rating, and scale back.
  const phiStar = Math.sqrt(phi ** 2 + volatility ** 2);
  const phiNew = 1 / Math.sqrt(1 / phiStar ** 2 + 1 / variance);
  const muNew = toMu(player.rating) + (phiNew ** 2 * improvement) / variance;
  return Object.freeze({
    rating: GLICKO2.SCALE * muNew + GLICKO2.START.rating,
    deviation: GLICKO2.SCALE * phiNew,
    volatility,
  });
}

/**
 * A rating after `periods` rating periods without games: only the deviation grows (step 6 for each period), and
 * never past where a new player starts, so a long break makes a rating as uncertain as a new one and no more.
 *
 * @param {{ player: Glicko, periods: number }} input  `periods` may be a fraction
 * @returns {Glicko}
 * @throws {RangeError} when `periods` is negative
 */
export function aged({ player, periods }) {
  if (!(periods >= 0)) {
    throw new RangeError(`A rating ages by zero or more periods, not ${periods}`);
  }
  if (periods === 0) {
    return player;
  }
  const phi = toPhi(player.deviation);
  const grown = Math.sqrt(phi ** 2 + periods * player.volatility ** 2) * GLICKO2.SCALE;
  return Object.freeze({ ...player, deviation: Math.min(GLICKO2.START.deviation, grown) });
}
