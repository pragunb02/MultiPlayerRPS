import { describe, expect, it } from "vitest";
import { BANDS, curateChessPuzzles, parsePuzzleCsv, PER_BAND } from "./curateChessPuzzles.mjs";

const HEADER =
  "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate";
const FEN = "5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27";
const MOVES = "d3d6 f8d8 d6d8 f6d8";

/** One CSV row in the Lichess layout. Only the fields a test cares about change. */
const row = ({ id, rating, plays = 5000, popularity = 95, deviation = 75, moves = MOVES, themes = "fork" }) =>
  [id, FEN, moves, rating, deviation, popularity, plays, themes, "https://lichess.org/x#1", "", ""].join(",");

/** Rows for every band, `count` in each, with ids that sort in the order they are made. */
function fullSet(count) {
  return BANDS.flatMap(({ min }, band) =>
    Array.from({ length: count }, (_, index) =>
      row({ id: `b${band}p${String(index).padStart(3, "0")}`, rating: min + index }),
    ),
  );
}

describe("curating the chess puzzles", () => {
  it("reads the Lichess CSV into puzzles with the counts that choose them", () => {
    const [puzzle] = parsePuzzleCsv([HEADER, row({ id: "0000D", rating: 1529 })].join("\n"));

    expect(puzzle).toEqual({
      id: "0000D",
      fen: FEN,
      moves: ["d3d6", "f8d8", "d6d8", "f6d8"],
      rating: 1529,
      deviation: 75,
      popularity: 95,
      plays: 5000,
      themes: ["fork"],
    });
  });

  it("refuses a file that is not in the Lichess layout", () => {
    expect(() => parsePuzzleCsv("id,fen\n1,2")).toThrow(/Lichess puzzle CSV/);
  });

  it("skips blank lines at the end", () => {
    expect(parsePuzzleCsv(`${HEADER}\n${row({ id: "a", rating: 900 })}\n\n`)).toHaveLength(1);
  });

  it("orders the set so the rating rises from Monday to Sunday every week", () => {
    const puzzles = curateChessPuzzles(parsePuzzleCsv([HEADER, ...fullSet(PER_BAND)].join("\n")));

    expect(puzzles).toHaveLength(PER_BAND * 7);
    const firstWeek = puzzles.slice(0, 7).map(({ rating }) => BANDS.findIndex(({ max }) => rating <= max));
    expect(firstWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(puzzles[7].id).toBe("b0p001");
    expect(Object.keys(puzzles[0])).toEqual(["id", "fen", "moves", "rating", "themes"]);
  });

  it("keeps only popular, often played, settled puzzles of one to four moves", () => {
    const rows = [
      ...fullSet(PER_BAND),
      row({ id: "a-unpopular", rating: 750, popularity: 80, plays: 99_999 }),
      row({ id: "a-rare", rating: 750, plays: 100 }),
      row({ id: "a-unsettled", rating: 750, deviation: 120, plays: 99_999 }),
      row({ id: "a-long", rating: 750, plays: 99_999, moves: "a a a a a a a a a a" }),
    ];

    const ids = curateChessPuzzles(parsePuzzleCsv([HEADER, ...rows].join("\n"))).map(({ id }) => id);

    expect(ids.filter((id) => id.startsWith("a-"))).toEqual([]);
  });

  it("takes the most played puzzles of a band", () => {
    const rows = [...fullSet(PER_BAND), row({ id: "zz-famous", rating: 700, plays: 1_000_000 })];

    const ids = curateChessPuzzles(parsePuzzleCsv([HEADER, ...rows].join("\n"))).map(({ id }) => id);

    expect(ids).toContain("zz-famous");
    expect(ids).toHaveLength(PER_BAND * 7);
  });

  it("refuses to make a set when a band is short", () => {
    const rows = fullSet(PER_BAND).slice(1);

    expect(() => curateChessPuzzles(parsePuzzleCsv([HEADER, ...rows].join("\n")))).toThrow(/700 to 1099/);
  });

  it("refuses a puzzle whose moves are not legal", () => {
    const rows = [
      ...fullSet(PER_BAND),
      row({ id: "b0bad", rating: 900, plays: 1_000_000, moves: "d3d6 f8f1" }),
    ];

    expect(() => curateChessPuzzles(parsePuzzleCsv([HEADER, ...rows].join("\n")))).toThrow(/b0bad/);
  });
});
