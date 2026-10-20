// Makes the daily chess puzzle set from the Lichess puzzle database (CC-144, ADR-061). The database is CC0
// (https://database.lichess.org/#puzzles). The owner or a builder downloads it, or the start of it, and runs
// scripts/bin/curate-chess-puzzles.mjs. The server never downloads it.
import { assertChessPuzzle } from "@classicade/games";

const COLUMNS =
  "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate";

/**
 * One band per weekday, Monday first, so the puzzles get harder through the week as a crossword does. The numbers
 * are Lichess puzzle ratings.
 */
export const BANDS = Object.freeze([
  Object.freeze({ min: 700, max: 1099 }),
  Object.freeze({ min: 1100, max: 1399 }),
  Object.freeze({ min: 1400, max: 1599 }),
  Object.freeze({ min: 1600, max: 1799 }),
  Object.freeze({ min: 1800, max: 1999 }),
  Object.freeze({ min: 2000, max: 2199 }),
  Object.freeze({ min: 2200, max: 2600 }),
]);

/** Puzzles per band. Seven bands of 58 make 406 puzzles, 58 weeks before a puzzle comes back. */
export const PER_BAND = 58;

/**
 * Which puzzles are good enough for everyone on one day. Players liked them (popularity is from -100 to 100),
 * many played them, the rating has settled, and the player finds one to four moves.
 */
const MIN_POPULARITY = 90;
const MIN_PLAYS = 2000;
const MAX_DEVIATION = 80;
const MAX_MOVES = 8;

/**
 * Reads the Lichess puzzle CSV. Its fields hold no commas, so a plain split is enough.
 *
 * @param {string} text  the whole file, or its start, header included
 * @returns {Array<{ id: string, fen: string, moves: string[], rating: number, deviation: number, popularity: number, plays: number, themes: string[] }>}
 * @throws {Error} when the header is not the Lichess one
 */
export function parsePuzzleCsv(text) {
  const [header, ...rows] = text.split("\n");
  if (header.trim() !== COLUMNS) {
    throw new Error(`Expected the Lichess puzzle CSV, with the header ${COLUMNS}`);
  }
  return rows
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [id, fen, moves, rating, deviation, popularity, plays, themes] = line.split(",");
      return {
        id,
        fen,
        moves: moves.split(" "),
        rating: Number(rating),
        deviation: Number(deviation),
        popularity: Number(popularity),
        plays: Number(plays),
        themes: themes.split(" ").filter(Boolean),
      };
    });
}

const byPlaysThenId = (a, b) => b.plays - a.plays || a.id.localeCompare(b.id);
const byId = (a, b) => a.id.localeCompare(b.id);

/**
 * The set in the order the days use it: week after week, Monday's band first. Each band holds its most played
 * puzzles, ordered by id, which Lichess makes at random. So neighbouring weeks get unrelated puzzles.
 *
 * @param {ReturnType<typeof parsePuzzleCsv>} candidates
 * @returns {Array<{ id: string, fen: string, moves: string[], rating: number, themes: string[] }>}
 * @throws {Error} when a band has too few good puzzles, or a chosen puzzle has an illegal move
 */
export function curateChessPuzzles(candidates) {
  const good = candidates.filter(
    (puzzle) =>
      puzzle.popularity >= MIN_POPULARITY &&
      puzzle.plays >= MIN_PLAYS &&
      puzzle.deviation <= MAX_DEVIATION &&
      puzzle.moves.length <= MAX_MOVES,
  );
  const bands = BANDS.map(({ min, max }) => {
    const chosen = good
      .filter(({ rating }) => rating >= min && rating <= max)
      .sort(byPlaysThenId)
      .slice(0, PER_BAND);
    if (chosen.length < PER_BAND) {
      throw new Error(`Only ${chosen.length} good puzzles rated ${min} to ${max}, ${PER_BAND} are needed`);
    }
    return chosen.sort(byId);
  });
  const ordered = Array.from({ length: PER_BAND }, (_, week) => bands.map((band) => band[week])).flat();
  return ordered.map(({ id, fen, moves, rating, themes }) => {
    const puzzle = { id, fen, moves, rating, themes };
    assertChessPuzzle(puzzle);
    return puzzle;
  });
}
