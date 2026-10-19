import { describe, expect, it } from "vitest";
import { createDailyPuzzleAccessor } from "../../data/dailyPuzzleAccessor.js";
import { createInMemoryDailyPuzzleAttemptDao } from "../../testing/inMemoryDailyPuzzleAttemptDao.js";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { createChessKind } from "./chessKind.js";
import { createDailyPuzzleComponent } from "./dailyPuzzleComponent.js";
import { INDIA_CALENDAR } from "./schedule.js";

/** Lichess 0000D (CC0): White plays Qd6, Black finds Rd8, White takes Qxd8+, Black finds Bxd8. */
const TWO_STEPS = Object.freeze({
  id: "0000D",
  fen: "5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27",
  moves: Object.freeze(["d3d6", "f8d8", "d6d8", "f6d8"]),
  rating: 1529,
  themes: Object.freeze(["advantage", "endgame", "short"]),
});
/** Lichess 001KR (CC0): mate in one. */
const MATE_IN_ONE = Object.freeze({
  id: "001KR",
  fen: "6Qk/p1p3pp/4N3/1p6/2q1r1n1/2B5/PP4PP/3R1R1K b - - 0 28",
  moves: Object.freeze(["h8g8", "f1f8"]),
  rating: 563,
  themes: Object.freeze(["mate", "mateIn1", "oneMove", "middlegame"]),
});

// Puzzle #2 (index 1) is the puzzle of Tuesday 2026-10-20, and #3 of the day after.
const SET = [MATE_IN_ONE, TWO_STEPS, MATE_IN_ONE];
const TUESDAY = "2026-10-20";
const WEDNESDAY = "2026-10-21";
const MONDAY = "2026-10-19";
/** Noon in India on a day. */
const noon = (day) => Date.parse(`${day}T06:30:00.000Z`);
const RIYA = "user_0123456789abcdef01234567";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";
const RIYA_IDENTITY = Object.freeze({ kind: "account", id: RIYA, displayName: "Riya" });

const WRONG = { from: "g8", to: "h8" };
const FIRST = { from: "f8", to: "d8" };
const SECOND = { from: "f6", to: "d8" };
const MATE = { from: "f1", to: "f8" };

function setup() {
  const attemptDao = createInMemoryDailyPuzzleAttemptDao();
  const dailyPuzzleAccessor = createDailyPuzzleAccessor({ attemptDao, catalogues: {} });
  const component = createDailyPuzzleComponent({
    dailyPuzzleAccessor,
    kinds: [createChessKind({ puzzles: SET })],
    calendar: INDIA_CALENDAR,
  });
  const play = (move, { playerId = RIYA, day = TUESDAY, now = noon(day) } = {}) =>
    component.play({ kind: "chess", playerId, day, move, now });
  return { component, attemptDao, play };
}

describe("the daily puzzle of a day", () => {
  it("is the same for everyone and shows the position without any move still to find", async () => {
    const { component } = setup();

    const view = await component.today({ kind: "chess", now: noon(TUESDAY) });

    expect(view).toEqual({
      kind: "chess",
      day: TUESDAY,
      number: 2,
      nextAt: Date.parse("2026-10-20T18:30:00.000Z"),
      rating: 1529,
      steps: 2,
      maxMistakes: 3,
      maxHints: 2,
      position: {
        fen: "5rk1/1p3ppp/pq1Q1b2/8/8/1P3N2/P4PPP/3R2K1 b - - 3 27",
        toMove: "b",
        player: "b",
        lastMove: { from: "d3", to: "d6", san: "Qd6" },
        line: [],
      },
      status: "new",
      mistakes: 0,
      hints: [],
      hintsTaken: 0,
      hintsLeft: 2,
      grid: ["notReached", "notReached"],
      streak: { current: 0, best: 0, playedToday: false, atRisk: false },
    });
    expect(JSON.stringify(view)).not.toMatch(/f8d8|Rd8|f6d8|Bxd8/);
  });

  it("moves on to the next puzzle when the day turns in India", async () => {
    const { component } = setup();

    const view = await component.today({ kind: "chess", now: Date.parse("2026-10-20T18:30:00.000Z") });

    expect(view).toMatchObject({ day: WEDNESDAY, number: 3, rating: 563 });
  });

  it("is the same for a player who has not started yet", async () => {
    const { component } = setup();

    const view = await component.todayFor({ kind: "chess", playerId: RIYA, now: noon(TUESDAY) });

    expect(view).toEqual(await component.today({ kind: "chess", now: noon(TUESDAY) }));
  });

  it("does not exist for a kind nobody made", async () => {
    const { component } = setup();

    expect(component.hasKind("chess")).toBe(true);
    expect(component.hasKind("sudoku")).toBe(false);
    await expect(component.today({ kind: "sudoku", now: noon(TUESDAY) })).rejects.toThrow(NotFoundError);
  });
});

describe("playing the daily puzzle", () => {
  it("answers a correct move with the reply, and keeps the rest of the solution back", async () => {
    const { play } = setup();

    const answer = await play(FIRST);

    expect(answer).toMatchObject({
      outcome: "correct",
      played: { san: "Rd8" },
      reply: { from: "d6", to: "d8", san: "Qxd8+" },
      puzzle: { status: "playing", position: { line: ["Rd8", "Qxd8+"] }, grid: ["firstTry", "notReached"] },
    });
    expect(JSON.stringify(answer)).not.toMatch(/f6d8|Bxd8/);
    expect(answer.puzzle).not.toHaveProperty("solution");
  });

  it("solves it with the last move, shows the solution and starts the streak", async () => {
    const { play } = setup();
    await play(FIRST);

    const answer = await play(SECOND);

    expect(answer).toMatchObject({
      outcome: "solved",
      played: { san: "Bxd8" },
      puzzle: {
        status: "solved",
        grid: ["firstTry", "firstTry"],
        solution: ["Rd8", "Qxd8+", "Bxd8"],
        sourceUrl: "https://lichess.org/training/0000D",
        streak: { current: 1, best: 1, playedToday: true, atRisk: false },
      },
    });
    expect(answer).not.toHaveProperty("reply");
  });

  it("counts a wrong move as a mistake and leaves the board where it was", async () => {
    const { play } = setup();

    const answer = await play(WRONG);

    expect(answer).toMatchObject({
      outcome: "wrong",
      played: { san: "Kh8" },
      puzzle: { status: "playing", mistakes: 1, position: { line: [] } },
    });
  });

  it("fails on the third mistake, shows the solution and breaks the streak", async () => {
    const { play } = setup();
    await play(MATE, { day: MONDAY });
    await play(WRONG);
    await play(WRONG);

    const answer = await play(WRONG);

    expect(answer).toMatchObject({
      outcome: "failed",
      puzzle: {
        status: "failed",
        mistakes: 3,
        grid: ["failed", "notReached"],
        solution: ["Rd8", "Qxd8+", "Bxd8"],
        streak: { current: 0, best: 1, playedToday: true },
      },
    });
  });

  it("refuses an illegal move without counting a mistake", async () => {
    const { play, component } = setup();

    const error = await play({ from: "f8", to: "f1" }).catch((err) => err);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.details).toEqual({ reason: "illegalMove" });
    expect(await component.todayFor({ kind: "chess", playerId: RIYA, now: noon(TUESDAY) })).toMatchObject({
      status: "playing",
      mistakes: 0,
    });
  });

  it("refuses a move once the attempt has ended", async () => {
    const { play } = setup();
    await play(FIRST);
    await play(SECOND);

    const error = await play(FIRST).catch((err) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.details).toEqual({ reason: "finished" });
  });

  it("refuses a move for a day that is no longer today", async () => {
    const { play } = setup();

    const error = await play(FIRST, { day: TUESDAY, now: noon(WEDNESDAY) }).catch((err) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.details).toEqual({ reason: "dayOver" });
  });

  it("refuses a move when another tab changed the attempt at the same moment", async () => {
    const { play, attemptDao } = setup();
    await play(WRONG);
    attemptDao.failNextUpdate();

    const error = await play(FIRST).catch((err) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.details).toEqual({ reason: "changed" });
  });

  it("adds a day to the streak after a solved yesterday, and puts it at risk the next day", async () => {
    const { play, component } = setup();
    await play(MATE, { day: MONDAY });
    await play(FIRST);
    await play(SECOND);

    const wednesday = await component.todayFor({ kind: "chess", playerId: RIYA, now: noon(WEDNESDAY) });

    expect(wednesday.streak).toEqual({ current: 2, best: 2, playedToday: false, atRisk: true });
  });

  it("keeps an attempt on the puzzle it started with, even if the set changed since", async () => {
    const { component, attemptDao } = setup();
    await attemptDao.insert({
      playerId: RIYA,
      kind: "chess",
      day: TUESDAY,
      puzzleId: "001KR",
      status: "playing",
      found: [],
      marks: [0],
      mistakes: 0,
      hints: [0],
      streak: 0,
      best: 0,
      version: 0,
      startedAt: new Date(noon(TUESDAY)),
      updatedAt: new Date(noon(TUESDAY)),
    });

    const answer = await component.play({
      kind: "chess",
      playerId: RIYA,
      day: TUESDAY,
      move: MATE,
      now: noon(TUESDAY),
    });

    expect(answer).toMatchObject({ outcome: "solved", puzzle: { rating: 563, steps: 1 } });
  });
});

describe("hints", () => {
  it("gives the idea first, then the piece, and no more than two", async () => {
    const { component } = setup();
    const hint = () =>
      component.takeHint({ kind: "chess", playerId: RIYA, day: TUESDAY, now: noon(TUESDAY) });

    const first = await hint();
    const second = await hint();
    const error = await hint().catch((err) => err);

    expect(first).toMatchObject({
      hint: "Look for a way to win material.",
      puzzle: { hintsTaken: 1, hintsLeft: 1 },
    });
    expect(second.puzzle).toMatchObject({
      status: "playing",
      hints: ["Look for a way to win material.", "Move your rook on f8."],
      hintsLeft: 0,
    });
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.details).toEqual({ reason: "noHintsLeft" });
  });

  it("shows only the hints for the move being looked for", async () => {
    const { component, play } = setup();
    await component.takeHint({ kind: "chess", playerId: RIYA, day: TUESDAY, now: noon(TUESDAY) });

    const answer = await play(FIRST);

    expect(answer.puzzle).toMatchObject({ hints: [], hintsTaken: 1, hintsLeft: 1 });
  });

  it("are refused once the attempt has ended or the day has turned", async () => {
    const { component, play } = setup();
    await play(FIRST);
    await play(SECOND);

    const ended = await component
      .takeHint({ kind: "chess", playerId: RIYA, day: TUESDAY, now: noon(TUESDAY) })
      .catch((err) => err);
    const late = await component
      .takeHint({ kind: "chess", playerId: GUEST, day: TUESDAY, now: noon(WEDNESDAY) })
      .catch((err) => err);

    expect(ended.details).toEqual({ reason: "finished" });
    expect(late.details).toEqual({ reason: "dayOver" });
  });
});

describe("a guest who signs in", () => {
  it("brings their days to the account and the streak is counted again", async () => {
    const { component, play } = setup();
    await play(MATE, { playerId: GUEST, day: MONDAY });
    await play(FIRST, { playerId: GUEST });
    await play(SECOND, { playerId: GUEST });

    const result = await component.transferPlayer({ from: GUEST, to: RIYA_IDENTITY, now: noon(TUESDAY) });

    expect(result).toEqual({ moved: { dailyPuzzles: 2 } });
    expect(await component.todayFor({ kind: "chess", playerId: RIYA, now: noon(TUESDAY) })).toMatchObject({
      status: "solved",
      streak: { current: 2, best: 2 },
    });
    expect(await component.todayFor({ kind: "chess", playerId: GUEST, now: noon(TUESDAY) })).toMatchObject({
      status: "new",
    });
  });

  it("keeps the account's own day where both played, and joins the streaks", async () => {
    const { component, play } = setup();
    await play(MATE, { playerId: GUEST, day: MONDAY });
    await play(WRONG, { playerId: GUEST });
    await play(FIRST);
    await play(SECOND);

    const result = await component.transferPlayer({ from: GUEST, to: RIYA_IDENTITY, now: noon(TUESDAY) });

    expect(result).toEqual({ moved: { dailyPuzzles: 1 } });
    expect(await component.todayFor({ kind: "chess", playerId: RIYA, now: noon(TUESDAY) })).toMatchObject({
      mistakes: 0,
      streak: { current: 2, best: 2 },
    });
  });

  it("moves nothing more when it runs again", async () => {
    const { component, play } = setup();
    await play(FIRST, { playerId: GUEST });
    await component.transferPlayer({ from: GUEST, to: RIYA_IDENTITY, now: noon(TUESDAY) });

    expect(await component.transferPlayer({ from: GUEST, to: RIYA_IDENTITY, now: noon(TUESDAY) })).toEqual({
      moved: { dailyPuzzles: 0 },
    });
  });
});

describe("a player's data", () => {
  it("is exported day by day without the moves", async () => {
    const { component, play } = setup();
    await play(FIRST);
    await component.takeHint({ kind: "chess", playerId: RIYA, day: TUESDAY, now: noon(TUESDAY) });
    await play(SECOND);

    const exported = await component.exportPlayer({ playerId: RIYA });

    expect(exported).toEqual([
      {
        kind: "chess",
        day: TUESDAY,
        puzzleId: "0000D",
        status: "solved",
        mistakes: 0,
        hintsTaken: 1,
        streak: 1,
        best: 1,
        startedAt: new Date(noon(TUESDAY)).toISOString(),
        finishedAt: new Date(noon(TUESDAY)).toISOString(),
      },
    ]);
  });

  it("leaves the finish time empty for a day still being played", async () => {
    const { component, play } = setup();
    await play(WRONG);

    expect((await component.exportPlayer({ playerId: RIYA }))[0].finishedAt).toBe("");
  });

  it("is erased, and erasing again changes nothing", async () => {
    const { component, play } = setup();
    await play(FIRST);

    expect(await component.erasePlayer({ playerId: RIYA })).toEqual({ erased: { dailyPuzzles: 1 } });
    expect(await component.erasePlayer({ playerId: RIYA })).toEqual({ erased: { dailyPuzzles: 0 } });
  });
});
