import { describe, expect, it } from "vitest";
import { afterHint, afterMove, BLANK_ATTEMPT, gridOf, hintsAt, isEnded, newAttempt } from "./attempt.js";

const T0 = Date.UTC(2026, 9, 20, 6);
const RULES = { maxMistakes: 3 };
const correct = (uci, solved = false) => ({ legal: true, correct: true, solved, played: { uci, san: uci } });
const wrong = { legal: true, correct: false, played: { uci: "a1a2", san: "Ra2" } };

const started = () =>
  newAttempt({ playerId: "p", kind: "chess", day: "2026-10-20", puzzleId: "0000D", steps: 2, now: T0 });

describe("a daily puzzle attempt", () => {
  it("starts with nothing found, no mistakes and no hints at each move", () => {
    expect(started()).toEqual({
      playerId: "p",
      kind: "chess",
      day: "2026-10-20",
      puzzleId: "0000D",
      status: "playing",
      found: [],
      marks: [0, 0],
      mistakes: 0,
      hints: [0, 0],
      streak: 0,
      best: 0,
      version: 0,
      startedAt: T0,
      updatedAt: T0,
      finishedAt: 0,
    });
  });

  it("keeps a correct move and goes on to the next one", () => {
    const { attempt, outcome } = afterMove({
      attempt: started(),
      judged: correct("f8d8"),
      ...RULES,
      now: T0 + 1,
    });

    expect(outcome).toBe("correct");
    expect(attempt).toMatchObject({ status: "playing", found: ["f8d8"], updatedAt: T0 + 1, finishedAt: 0 });
  });

  it("is solved by the last correct move", () => {
    const first = afterMove({ attempt: started(), judged: correct("f8d8"), ...RULES, now: T0 }).attempt;

    const { attempt, outcome } = afterMove({
      attempt: first,
      judged: correct("f6d8", true),
      ...RULES,
      now: T0 + 9,
    });

    expect(outcome).toBe("solved");
    expect(attempt).toMatchObject({ status: "solved", found: ["f8d8", "f6d8"], finishedAt: T0 + 9 });
    expect(isEnded(attempt)).toBe(true);
  });

  it("counts a wrong move against the move being looked for", () => {
    const first = afterMove({ attempt: started(), judged: correct("f8d8"), ...RULES, now: T0 }).attempt;

    const { attempt, outcome } = afterMove({ attempt: first, judged: wrong, ...RULES, now: T0 });

    expect(outcome).toBe("wrong");
    expect(attempt).toMatchObject({ status: "playing", found: ["f8d8"], marks: [0, 1], mistakes: 1 });
  });

  it("fails with the last mistake allowed", () => {
    let attempt = started();
    const outcomes = [];
    for (let i = 0; i < 3; i += 1) {
      const next = afterMove({ attempt, judged: wrong, ...RULES, now: T0 + i });
      attempt = next.attempt;
      outcomes.push(next.outcome);
    }

    expect(outcomes).toEqual(["wrong", "wrong", "failed"]);
    expect(attempt).toMatchObject({ status: "failed", mistakes: 3, marks: [3, 0], finishedAt: T0 + 2 });
  });

  it("counts a hint at the move being looked for", () => {
    const first = afterMove({ attempt: started(), judged: correct("f8d8"), ...RULES, now: T0 }).attempt;

    const hinted = afterHint({ attempt: first, now: T0 + 5 });

    expect(hinted).toMatchObject({ hints: [0, 1], updatedAt: T0 + 5 });
    expect(hintsAt(hinted)).toBe(1);
    expect(hintsAt(started())).toBe(0);
  });

  it("has a blank attempt for a player who has not started", () => {
    expect(BLANK_ATTEMPT).toMatchObject({ status: "new", found: [], mistakes: 0 });
    expect(hintsAt(BLANK_ATTEMPT)).toBe(0);
    expect(isEnded(BLANK_ATTEMPT)).toBe(false);
  });
});

describe("the share grid of an attempt", () => {
  it("marks each move found first time or after a mistake, then the ones not reached", () => {
    const attempt = { status: "playing", found: ["a", "b"], marks: [0, 2, 0, 0] };

    expect(gridOf({ attempt, steps: 4 })).toEqual(["firstTry", "afterMistakes", "notReached", "notReached"]);
  });

  it("marks the move where a failed attempt ended", () => {
    const attempt = { status: "failed", found: ["a"], marks: [1, 3] };

    expect(gridOf({ attempt, steps: 2 })).toEqual(["afterMistakes", "failed"]);
  });

  it("stops at the checkmate that solved a puzzle early", () => {
    const attempt = { status: "solved", found: ["a"], marks: [0, 0] };

    expect(gridOf({ attempt, steps: 2 })).toEqual(["firstTry"]);
  });

  it("is all not reached before the first move", () => {
    expect(gridOf({ attempt: BLANK_ATTEMPT, steps: 2 })).toEqual(["notReached", "notReached"]);
  });
});
