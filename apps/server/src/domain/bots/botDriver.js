import { assertDefined, assertFunction } from "../../utils/assert.js";
import { GoneError, NotFoundError } from "../../utils/errors.js";
import { ROOM_EVENTS } from "../rooms/roomComponent.js";

const RETRY_MS = 2_000;
const MAX_ATTEMPTS = 3;

/** How long a computer player waits before it acts, in production. Long enough to feel like thinking. */
export const HUMAN_PAUSE_MS = Object.freeze({ min: 400, max: 900 });

/**
 * A pause between `min` and `max` milliseconds, different each time.
 *
 * @param {{ min: number, max: number, random?: () => number }} range  `random` returns a number in [0, 1)
 * @returns {() => number}
 */
export function pauseBetween({ min, max, random = Math.random }) {
  if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min)) {
    throw new RangeError("A pause needs whole milliseconds with min <= max");
  }
  return () => min + Math.floor(random() * (max - min + 1));
}

/** The room closed or no longer has this seat: there is nothing left for the computer player to do in it. */
const isGone = (err) => err instanceof NotFoundError || err instanceof GoneError;

/**
 * Plays for the computer players seated in rooms (CC-138). It watches every saved room change, and when a computer
 * player has something to do (its turn, a draw offer to answer, a rematch a person asked for) it does it after a
 * short, human-like pause. It acts through the room component like any player, so the engine checks its moves.
 *
 * Plans live only in this process. Rooms live in storage, so after a restart `resume` looks at every stored room
 * and plans again, and a computer player whose turn it was simply moves.
 *
 * Before it acts it reads the room again and asks what to do once more. When the answer changed (the person moved,
 * left or the game ended) it does nothing and plans from the room as it is now, so it never acts on a finished game
 * or an old position.
 *
 * @param {{
 *   roomComponent: Pick<ReturnType<typeof import("../rooms/roomComponent.js").createRoomComponent>, "getRoom" | "makeMove" | "requestRematch">,
 *   roomAccessor: Pick<ReturnType<typeof import("../../data/roomAccessor.js").createRoomAccessor>, "listAll">,
 *   botTurns: Pick<ReturnType<typeof import("./botTurns.js").createBotTurns>, "nextAction" | "moveFor">,
 *   events: { emit: (event: string, payload: unknown) => void },
 *   delayMs: (action: Readonly<import("./botTurns.js").BotAction>) => number,
 *   logger: Pick<import("../../utils/logger.js").Logger, "warn" | "error">,
 *   now?: () => number,
 *   retryMs?: number,
 * }} deps  `delayMs` is the pause before each action, zero in tests. `retryMs` is the pause before trying again
 *   after the database failed
 */
export function createBotDriver({
  roomComponent,
  roomAccessor,
  botTurns,
  events,
  delayMs,
  logger,
  now = Date.now,
  retryMs = RETRY_MS,
}) {
  assertDefined(roomComponent, "roomComponent");
  assertFunction(roomAccessor?.listAll, "roomAccessor.listAll");
  assertDefined(botTurns, "botTurns");
  assertFunction(events?.emit, "events.emit");
  assertFunction(delayMs, "delayMs");
  assertDefined(logger, "logger");

  /**
   * One plan per room code: what it is for, and its timer. A plan stays while it is being carried out, so a change
   * that arrives meanwhile and asks for the same thing does not plan it a second time.
   */
  const plans = new Map();
  let stopped = false;

  function plan(code, key, waitMs, attempt) {
    const entry = { key, timer: undefined };
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      act(code, key, attempt)
        .catch((err) => logger.error({ err, roomCode: code }, "computer player failed"))
        .finally(() => plans.get(code) === entry && plans.delete(code));
    }, waitMs);
    entry.timer.unref();
    plans.set(code, entry);
  }

  function cancel(code) {
    const planned = plans.get(code);
    if (planned !== undefined) {
      clearTimeout(planned.timer);
      plans.delete(code);
    }
  }

  /** Plans what the room's computer player should do, or drops a plan that no longer fits. */
  function watch(room) {
    if (stopped) return;
    const action = botTurns.nextAction(room);
    if (action.kind === "none") {
      cancel(room.code);
      return;
    }
    if (plans.get(room.code)?.key === action.key) return;
    cancel(room.code);
    plan(room.code, action.key, delayMs(action), 1);
  }

  async function perform(room, action) {
    const input = { code: room.code, playerId: action.playerId, now: now() };
    if (action.kind === "rematch") {
      return roomComponent.requestRematch(input);
    }
    const move = action.kind === "answer" ? action.move : botTurns.moveFor(room, action.playerId);
    return roomComponent.makeMove({ ...input, move });
  }

  async function act(code, key, attempt) {
    if (stopped) return;
    try {
      const room = await roomComponent.getRoom(code);
      const action = botTurns.nextAction(room);
      if (action.key !== key) {
        watch(room);
        return;
      }
      const changed = await perform(room, action);
      // The person in the room only hears about it through this: nobody's socket made the change.
      events.emit(ROOM_EVENTS.UPDATED, { room: changed });
    } catch (err) {
      if (isGone(err)) return;
      if (attempt >= MAX_ATTEMPTS) throw err;
      logger.warn({ err, roomCode: code, attempt }, "computer player will try again");
      plan(code, key, retryMs, attempt + 1);
    }
  }

  return Object.freeze({
    /**
     * Subscribed to every saved room change.
     *
     * @param {Readonly<import("../../data/roomAccessor.js").Room>} room
     */
    watch,

    /** Plans for every stored room. Called at start up, and now and then in case a plan was lost. */
    async resume() {
      for (const room of await roomAccessor.listAll()) {
        watch(room);
      }
    },

    /** Cancels every plan. Called when the server shuts down, before the database closes. */
    stop() {
      stopped = true;
      [...plans.keys()].forEach(cancel);
    },
  });
}
