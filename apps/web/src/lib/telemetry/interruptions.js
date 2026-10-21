import {
  bucketOf,
  INTERRUPTION_OUTCOMES,
  INTERRUPTION_PHASES,
  isFunnelStep,
  isSurfaceId,
  SURFACE_CLASSES,
  SURFACE_OPENERS,
  surfaceNamed,
  TELEMETRY_BUCKETS,
} from "@classicade/shared";
import { NO_TELEMETRY } from "./facade.js";

/**
 * Interruptions and steps (CC-313): every toast, banner, dialog, card, line, request and screen the site shows, how
 * each ended, how many a visit and a game had, and the steps of the registered funnels. Worked out in the browser and
 * sent as anonymous counts through the usage counts facade (CC-174), only while the `interruption_counts` flag is on.
 * It measures: it never delays, queues or hides a surface.
 */

const { ACTED, COVERED, DISMISSED, PAGE_LEFT, TIMED_OUT } = INTERRUPTION_OUTCOMES;
const SHOWN_EDGES_MS = Object.freeze([1000, 3000, 10_000]);
const COUNT_EDGES = Object.freeze([1, 2, 3, 6]);
const BLOCKING_EDGES = Object.freeze([1, 2]);
const BEFORE_EDGES = Object.freeze([1, 2, 3]);
const STACK = TELEMETRY_BUCKETS.STACK;

/** The match frame's phases (games/roomView.js `matchPhase`) as the interruption events name them. */
const PHASES = Object.freeze({
  waiting: INTERRUPTION_PHASES.BEFORE_PLAY,
  "my-turn": INTERRUPTION_PHASES.PLAYING,
  "their-turn": INTERRUPTION_PHASES.PLAYING,
  finished: INTERRUPTION_PHASES.RESULT,
});

/**
 * The phase of a match frame's phase, or `elsewhere` outside a game (watching included).
 *
 * @param {string | undefined} matchPhase
 * @returns {string}
 */
export const phaseOf = (matchPhase) =>
  PHASES[/** @type {string} */ (matchPhase)] ?? INTERRUPTION_PHASES.ELSEWHERE;

/** A count of interruptions of one kind in a visit or a game, never more than its buckets say. */
const counts = () => ({ optional: 0, blockingOptional: 0, essential: 0 });
const countedFields = (tally) => ({
  optional: bucketOf(tally.optional, COUNT_EDGES, TELEMETRY_BUCKETS.INTERRUPTIONS),
  blocking_optional: bucketOf(
    tally.blockingOptional,
    BLOCKING_EDGES,
    TELEMETRY_BUCKETS.BLOCKING_INTERRUPTIONS,
  ),
  essential: bucketOf(tally.essential, COUNT_EDGES, TELEMETRY_BUCKETS.INTERRUPTIONS),
});

/**
 * @typedef {Object} InterruptionHandle   one showing of one surface
 * @property {() => void} acted       its own action was pressed
 * @property {() => void} dismissed   it was closed (a close button, Escape, a swipe)
 * @property {() => void} timedOut    it went away by itself
 * @property {(outcome?: string) => void} end   it is gone: with the outcome marked before, or the one given
 */

/**
 * @param {{
 *   telemetry: { track: (name: string, fields: Record<string, string | boolean>) => void },
 *   now: () => number,
 *   strict?: boolean,   throw on a surface that may not open now (tests and development)
 * }} deps
 */
export function createInterruptionTracker({ telemetry, now, strict = false }) {
  let enabled = false;
  let phase = INTERRUPTION_PHASES.ELSEWHERE;
  let game = { id: "", tally: undefined };
  let visit = counts();
  let optionalSoFar = 0;
  let sequence = 0;
  /** @type {Map<object, { spec: ReturnType<typeof surfaceNamed>, openedAt: number, stack: string, phase: string, trigger: string, seq: number, marked?: string }>} */
  const visible = new Map();
  const reached = new Set();
  let firstEnded = () => undefined;
  let endedOnce = false;

  const track = (name, fields) => {
    if (enabled) telemetry.track(name, fields);
  };

  function count(spec, trigger, tally) {
    if (spec.class === SURFACE_CLASSES.ESSENTIAL) tally.essential += 1;
    else if (trigger === SURFACE_OPENERS.SYSTEM) {
      tally.optional += 1;
      if (spec.blocking) tally.blockingOptional += 1;
    }
  }

  function end(handle, outcome) {
    const shown = visible.get(handle);
    if (shown === undefined) return;
    visible.delete(handle);
    // A dialog closed by one of its own buttons answered it. Anything else that went without a mark went by itself.
    const chosen = outcome ?? shown.marked ?? (shown.spec.kind === "dialog" ? ACTED : TIMED_OUT);
    const coveredBy = [...visible.values()].some((other) => other.seq > shown.seq);
    const final = chosen !== ACTED && chosen !== PAGE_LEFT && coveredBy ? COVERED : chosen;
    if (enabled && !endedOnce) {
      endedOnce = true;
      firstEnded();
    }
    track("interruption_ended", {
      surface: shown.spec.id,
      kind: shown.spec.kind,
      class: shown.spec.class,
      blocking: shown.spec.blocking,
      outcome: final,
      shown_ms: bucketOf(now() - shown.openedAt, SHOWN_EDGES_MS, TELEMETRY_BUCKETS.SHOWN_MS),
      phase: shown.phase,
      trigger: shown.trigger,
      stack: shown.stack,
    });
  }

  return Object.freeze({
    /** @param {boolean} on  the `interruption_counts` flag's answer */
    setEnabled(on) {
      enabled = on;
    },

    /**
     * A surface is showing from now on.
     *
     * @param {string} surfaceId  a registered surface
     * @param {{ trigger?: "player" | "system" }} [options]  who opened it, the registry's `opens` by default
     * @returns {InterruptionHandle}
     * @throws {RangeError} for an unregistered surface, and in strict mode for an optional blocking surface the
     *   system opens during play (CC-313 section 5: never during a game)
     */
    open(surfaceId, { trigger } = {}) {
      const spec = surfaceNamed(surfaceId);
      const opener = trigger ?? spec.opens;
      const optionalBlocking = spec.class === SURFACE_CLASSES.OPTIONAL && spec.blocking;
      if (
        strict &&
        optionalBlocking &&
        opener === SURFACE_OPENERS.SYSTEM &&
        phase === INTERRUPTION_PHASES.PLAYING
      ) {
        throw new RangeError(`"${surfaceId}" is optional and blocking, so it may not open during a game`);
      }
      const handle = {};
      visible.set(handle, {
        spec,
        openedAt: now(),
        stack: STACK[Math.min(visible.size, STACK.length - 1)],
        phase,
        trigger: opener,
        seq: ++sequence,
      });
      count(spec, opener, visit);
      if (game.tally !== undefined && phase === INTERRUPTION_PHASES.PLAYING) count(spec, opener, game.tally);
      if (spec.class === SURFACE_CLASSES.OPTIONAL && opener === SURFACE_OPENERS.SYSTEM) optionalSoFar += 1;
      const mark = (outcome) => () => {
        const shown = visible.get(handle);
        if (shown !== undefined) shown.marked = outcome;
      };
      return Object.freeze({
        acted: mark(ACTED),
        dismissed: mark(DISMISSED),
        timedOut: mark(TIMED_OUT),
        end: (outcome) => end(handle, outcome),
      });
    },

    /**
     * The match frame's phase changed (or the page left a game): a game starts when play starts, and is counted when
     * its result shows.
     *
     * @param {string | undefined} matchPhase  `waiting`, `my-turn`, `their-turn`, `finished`, `watching` or undefined
     * @param {string} [gameId]
     */
    notePhase(matchPhase, gameId = "") {
      const next = phaseOf(matchPhase);
      if (next === INTERRUPTION_PHASES.PLAYING && game.tally === undefined)
        game = { id: gameId, tally: counts() };
      if (next === INTERRUPTION_PHASES.RESULT && game.tally !== undefined) {
        track("interruption_counted", { scope: "game", game_id: game.id, ...countedFields(game.tally) });
      }
      if (next !== INTERRUPTION_PHASES.PLAYING) game = { id: "", tally: undefined };
      phase = next;
    },

    /** @returns {string} the bucket of optional interruptions the system opened since the page loaded */
    interruptionsBefore: () => bucketOf(optionalSoFar, BEFORE_EDGES, TELEMETRY_BUCKETS.INTERRUPTIONS_BEFORE),

    /** Whether counts of interruptions are on, so other events may carry their fields. */
    isEnabled: () => enabled,

    /**
     * A registered step was reached. Each is sent once per page load.
     *
     * @param {string} funnel
     * @param {string} step
     * @throws {RangeError} for a step that is not registered in that funnel
     */
    reach(funnel, step) {
      if (!isFunnelStep(funnel, step))
        throw new RangeError(`"${step}" is not a step of the funnel "${funnel}"`);
      const key = `${funnel}.${step}`;
      if (reached.has(key)) return;
      reached.add(key);
      track("funnel_step_reached", { funnel, step });
    },

    /**
     * The surface a pressed element is inside, read from the `data-cc-surface` the surfaces put on their root.
     *
     * @param {Element} element
     * @returns {string | undefined}
     */
    surfaceOf(element) {
      if (!enabled) return undefined;
      const id = element.closest("[data-cc-surface]")?.getAttribute("data-cc-surface");
      return isSurfaceId(id) ? id : undefined;
    },

    /** The page is being left: every surface still showing ends as `page_left`, then the visit is counted. */
    pageLeft() {
      [...visible.keys()].forEach((handle) => end(handle, PAGE_LEFT));
      track("interruption_counted", { scope: "visit", ...countedFields(visit) });
      visit = counts();
    },

    /**
     * @param {() => void} listener  told once, at the first interruption counted on this page (the flag's success)
     */
    onFirstEnded(listener) {
      firstEnded = listener;
    },

    /** Surfaces showing now, for tests. */
    showing: () => [...visible.values()].map(({ spec }) => spec.id),
  });
}

/** A tracker that counts nothing, for tests and pages without services. */
export const NO_INTERRUPTIONS = createInterruptionTracker({ telemetry: NO_TELEMETRY, now: Date.now });
