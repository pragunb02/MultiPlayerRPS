import { DAILY_PUZZLE_REFUSALS, DAILY_PUZZLE_STATUS } from "@classicade/shared";
import { assertDefined } from "../../utils/assert.js";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { afterHint, afterMove, BLANK_ATTEMPT, gridOf, hintsAt, isEnded, newAttempt } from "./attempt.js";
import { rebuildStreaks, streakAfter, streakView } from "./puzzleStreak.js";
import { scheduleOn } from "./schedule.js";

/**
 * @typedef {import("../../data/dailyPuzzleAccessor.js").DailyPuzzleAttempt} DailyPuzzleAttempt
 * @typedef {import("./chessKind.js").PuzzleKind} PuzzleKind
 */

const sum = (counts) => counts.reduce((total, count) => total + count, 0);
const isoOrEmpty = (ms) => (ms > 0 ? new Date(ms).toISOString() : "");

/**
 * The daily puzzles (CC-144, ADR-061): one puzzle of each kind a day, the same for everyone, played by guests and
 * accounts. The kind's referee judges each move here on the server. Nothing the component answers holds a move the
 * player still has to find. The whole solution is in the answer only once the day's attempt has ended.
 *
 * A puzzle is not a match. It gives no XP and never counts towards the play streak, quests, achievements or
 * leaderboards (ADR-013). Each kind has its own streak, kept on each day's attempt.
 *
 * @param {{
 *   dailyPuzzleAccessor: ReturnType<typeof import("../../data/dailyPuzzleAccessor.js").createDailyPuzzleAccessor>,
 *   kinds: ReadonlyArray<Readonly<PuzzleKind>>,
 *   calendar: Readonly<import("./schedule.js").PuzzleCalendar>,  which day a moment falls on, and when the next starts
 * }} deps
 */
export function createDailyPuzzleComponent({ dailyPuzzleAccessor, kinds, calendar }) {
  assertDefined(dailyPuzzleAccessor, "dailyPuzzleAccessor");
  assertDefined(calendar, "calendar");
  const byId = new Map(kinds.map((kind) => [kind.id, kind]));

  function kindOf(id) {
    if (!byId.has(id)) {
      throw new NotFoundError("There is no such daily puzzle");
    }
    return byId.get(id);
  }

  /** Today's puzzle of a kind, by the schedule. */
  function scheduled(kind, day) {
    const { number, index } = scheduleOn({ day, count: kind.count });
    return { number, puzzle: kind.puzzleAt(index) };
  }

  /** The streak as the player sees it today, from today's attempt when it has ended, else the latest ended one. */
  async function streakOf({ kind, playerId, today, attempt }) {
    const latest = isEnded(attempt)
      ? [attempt]
      : await dailyPuzzleAccessor.findLatestFinished({ playerId, kind: kind.id, beforeDay: today });
    return streakView({ latest, today });
  }

  /** What a player sees of a puzzle. The solution and its source only once the attempt has ended. */
  function viewOf({ kind, day, number, puzzle, attempt, streak, now }) {
    const steps = kind.steps(puzzle);
    const hintsTaken = sum(attempt.hints);
    const ended = isEnded(attempt);
    return {
      kind: kind.id,
      day,
      number,
      nextAt: calendar.nextDayAt(now),
      rating: kind.rating(puzzle),
      steps,
      maxMistakes: kind.maxMistakes,
      maxHints: kind.maxHints,
      position: kind.position({ puzzle, found: attempt.found }),
      status: attempt.status,
      mistakes: attempt.mistakes,
      hints: ended
        ? []
        : Array.from({ length: hintsAt(attempt) }, (_, at) =>
            kind.hint({ puzzle, found: attempt.found, level: at + 1 }),
          ),
      hintsTaken,
      hintsLeft: kind.maxHints - hintsTaken,
      grid: gridOf({ attempt, steps }),
      streak,
      ...(ended && { solution: kind.solution(puzzle), sourceUrl: kind.sourceUrl(puzzle) }),
    };
  }

  /** The player's attempt today, or the blank one, with the puzzle it is on. */
  async function stateFor({ kind, playerId, today }) {
    const [attempt] = await dailyPuzzleAccessor.findDay({ playerId, kind: kind.id, day: today });
    const { number, puzzle } = scheduled(kind, today);
    if (attempt === undefined) {
      return { number, puzzle, attempt: BLANK_ATTEMPT, stored: false };
    }
    // An attempt stays on the puzzle it started with, even if a deploy changed the set during the day.
    return { number, puzzle: kind.puzzleById(attempt.puzzleId), attempt, stored: true };
  }

  async function playerView({ kind, playerId, today, number, puzzle, attempt, now }) {
    const streak = await streakOf({ kind, playerId, today, attempt });
    return viewOf({ kind, day: today, number, puzzle, attempt, streak, now });
  }

  /**
   * The player's attempt, stored if this is their first move or hint today. Refuses a day that is over and an
   * attempt that has ended.
   */
  async function openAttempt({ kind, playerId, day, now }) {
    const today = calendar.dayOf(now);
    if (day !== today) {
      throw new ConflictError("A new puzzle is out", { details: { reason: DAILY_PUZZLE_REFUSALS.DAY_OVER } });
    }
    const state = await stateFor({ kind, playerId, today });
    const attempt = state.stored
      ? state.attempt
      : await dailyPuzzleAccessor.start(
          newAttempt({
            playerId,
            kind: kind.id,
            day: today,
            puzzleId: state.puzzle.id,
            steps: kind.steps(state.puzzle),
            now,
          }),
        );
    if (isEnded(attempt)) {
      throw new ConflictError("Today's puzzle is over for you", {
        details: { reason: DAILY_PUZZLE_REFUSALS.FINISHED },
      });
    }
    return { ...state, today, attempt };
  }

  return Object.freeze({
    /** @param {string} kind @returns {boolean} whether there is a daily puzzle of that kind */
    hasKind: (kind) => byId.has(kind),

    /**
     * Today's puzzle as anyone sees it before playing, a visitor included.
     *
     * @param {{ kind: string, now: number }} query
     * @throws {NotFoundError} for an unknown kind
     */
    async today({ kind: kindId, now }) {
      const kind = kindOf(kindId);
      const today = calendar.dayOf(now);
      const { number, puzzle } = scheduled(kind, today);
      const streak = streakView({ latest: [], today });
      return viewOf({ kind, day: today, number, puzzle, attempt: BLANK_ATTEMPT, streak, now });
    },

    /**
     * Today's puzzle as a player sees it: their attempt so far and their streak.
     *
     * @param {{ kind: string, playerId: string, now: number }} query
     * @throws {NotFoundError} for an unknown kind
     */
    async todayFor({ kind: kindId, playerId, now }) {
      const kind = kindOf(kindId);
      const today = calendar.dayOf(now);
      return playerView({ kind, playerId, today, now, ...(await stateFor({ kind, playerId, today })) });
    },

    /**
     * Plays the player's next move in today's puzzle.
     *
     * @param {{ kind: string, playerId: string, day: string, move: object, now: number }} input  day: the day the
     *   page shows, so a move made on a page left open overnight never lands on the new puzzle
     * @returns {Promise<{ outcome: string, played: { san: string }, reply?: { from: string, to: string, san: string }, puzzle: object }>}
     * @throws {NotFoundError} for an unknown kind
     * @throws {ValidationError} for a move that cannot be played. It costs no mistake
     * @throws {ConflictError} when the day is over, the attempt has ended, or another tab changed it at once
     */
    async play({ kind: kindId, playerId, day, move, now }) {
      const kind = kindOf(kindId);
      const { today, number, puzzle, attempt } = await openAttempt({ kind, playerId, day, now });
      const judged = kind.judge({ puzzle, found: attempt.found, move });
      if (!judged.legal) {
        throw new ValidationError("That move is not possible here", {
          details: { reason: DAILY_PUZZLE_REFUSALS.ILLEGAL_MOVE },
        });
      }
      const next = afterMove({ attempt, judged, maxMistakes: kind.maxMistakes, now });
      const ended = isEnded(next.attempt)
        ? {
            ...next.attempt,
            ...streakAfter({
              previous: await dailyPuzzleAccessor.findLatestFinished({
                playerId,
                kind: kind.id,
                beforeDay: today,
              }),
              day: today,
              solved: next.attempt.status === DAILY_PUZZLE_STATUS.SOLVED,
            }),
          }
        : next.attempt;
      const saved = await dailyPuzzleAccessor.save(ended);
      const { reply } = judged;
      return {
        outcome: next.outcome,
        played: { san: judged.played.san },
        ...(reply !== undefined && { reply: { from: reply.from, to: reply.to, san: reply.san } }),
        puzzle: await playerView({ kind, playerId, today, number, puzzle, attempt: saved, now }),
      };
    },

    /**
     * Gives the player the next hint for the move they are looking for.
     *
     * @param {{ kind: string, playerId: string, day: string, now: number }} input
     * @returns {Promise<{ hint: string, puzzle: object }>}
     * @throws {NotFoundError} for an unknown kind
     * @throws {ConflictError} when the day is over, the attempt has ended, every hint was taken, or another tab
     *   changed the attempt at once
     */
    async takeHint({ kind: kindId, playerId, day, now }) {
      const kind = kindOf(kindId);
      const { today, number, puzzle, attempt } = await openAttempt({ kind, playerId, day, now });
      if (sum(attempt.hints) >= kind.maxHints) {
        throw new ConflictError("No hints left today", {
          details: { reason: DAILY_PUZZLE_REFUSALS.NO_HINTS_LEFT },
        });
      }
      const saved = await dailyPuzzleAccessor.save(afterHint({ attempt, now }));
      return {
        hint: kind.hint({ puzzle, found: saved.found, level: hintsAt(saved) }),
        puzzle: await playerView({ kind, playerId, today, number, puzzle, attempt: saved, now }),
      };
    },

    /**
     * A guest just signed in (ADR-014): each of their days moves to the account, unless the account played that
     * day itself, and then the account's streaks are counted again from the start. Running it twice moves nothing
     * more. A change in another tab at the same moment fails it, and the transfer runs again later.
     *
     * @param {{ from: string, to: Readonly<import("../../models/identity.js").Identity>, now: number }} transfer
     * @returns {Promise<{ moved: { dailyPuzzles: number } }>}
     */
    async transferPlayer({ from, to }) {
      const key = ({ kind, day }) => `${kind}|${day}`;
      const own = new Set((await dailyPuzzleAccessor.listByPlayer(to.id)).map(key));
      let moved = 0;
      for (const day of await dailyPuzzleAccessor.listByPlayer(from)) {
        if (own.has(key(day))) {
          await dailyPuzzleAccessor.removeDay(day);
        } else {
          moved += await dailyPuzzleAccessor.reassign({ from, to: to.id, kind: day.kind, day: day.day });
        }
      }
      const days = await dailyPuzzleAccessor.listByPlayer(to.id);
      for (const kind of new Set(days.map((day) => day.kind))) {
        const ofKind = days.filter((day) => day.kind === kind);
        const rebuilt = rebuildStreaks(ofKind);
        for (const [index, day] of ofKind.entries()) {
          const { streak, best } = rebuilt[index];
          if (day.streak !== streak || day.best !== best) {
            await dailyPuzzleAccessor.save({ ...day, streak, best });
          }
        }
      }
      return { moved: { dailyPuzzles: moved } };
    },

    /**
     * The player's days, for their data export (CC-035). The moves are left out: they are the puzzle's, not the
     * player's.
     *
     * @param {{ playerId: string }} query
     */
    exportPlayer: async ({ playerId }) =>
      (await dailyPuzzleAccessor.listByPlayer(playerId)).map((day) => ({
        kind: day.kind,
        day: day.day,
        puzzleId: day.puzzleId,
        status: day.status,
        mistakes: day.mistakes,
        hintsTaken: sum(day.hints),
        streak: day.streak,
        best: day.best,
        startedAt: isoOrEmpty(day.startedAt),
        finishedAt: isoOrEmpty(day.finishedAt),
      })),

    /**
     * Deletes every day of the player (CC-035). Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: { dailyPuzzles: number } }>}
     */
    erasePlayer: async ({ playerId }) => ({
      erased: { dailyPuzzles: await dailyPuzzleAccessor.removePlayer(playerId) },
    }),
  });
}
