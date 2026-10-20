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
 * and plans again, and a computer player whose turn it was simply moves. The housekeeping sweep calls `resume`
 * every minute too, so a plan dropped after the database failed three times in a row is made again.
 *
 * Choosing a move goes through the thinking queue (see thinkingQueue.js), which thinks hard moves off the event
 * loop, so computer players never hold up the people on the server (ADR-067). Accepting a rematch goes through the bot component, which keeps
 * the person within their limit of games against computers.
 *
 * Before it acts it reads the room again and asks what to do once more. When the answer changed (the person moved,
 * left or the game ended) it does nothing and plans from the room as it is now, so it never acts on a finished game
 * or an old position.
 *
 * @param {{
 *   roomComponent: Pick<ReturnType<typeof import("../rooms/roomComponent.js").createRoomComponent>, "getRoom" | "makeMove">,
 *   roomAccessor: Pick<ReturnType<typeof import("../../data/roomAccessor.js").createRoomAccessor>, "listAll">,
 *   botTurns: Pick<ReturnType<typeof import("./botTurns.js").createBotTurns>, "nextAction" | "turnFor">,
 *   botComponent: Pick<ReturnType<typeof import("./botComponent.js").createBotComponent>, "acceptRematch">,
 *   thinking: ReturnType<typeof import("./thinkingQueue.js").createThinkingQueue>,
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
  botComponent,
  thinking,
  events,
  delayMs,
  logger,
  now = Date.now,
  retryMs = RETRY_MS,
}) {
  assertDefined(roomComponent, "roomComponent");
  assertFunction(roomAccessor?.listAll, "roomAccessor.listAll");
  assertDefined(botTurns, "botTurns");
  assertFunction(botComponent?.acceptRematch, "botComponent.acceptRematch");
  assertFunction(thinking?.think, "thinking.think");
  assertFunction(thinking?.stop, "thinking.stop");
  assertFunction(events?.emit, "events.emit");
  assertFunction(delayMs, "delayMs");
  assertDefined(logger, "logger");

  /**
   * One plan per room code: what it is for, its timer, and whether it is being carried out. A room has at most one
   * action in flight (CC-318). A change that arrives meanwhile is kept as `next`, the newest saved room, and the
   * driver plans from it when the action ends. Two actions at once could both read the same sealed throw, and the
   * second, sent after the first had ended the round, was refused as not the move it locked in.
   */
  const plans = new Map();
  let stopped = false;

  function plan(code, key, waitMs, attempt) {
    const entry = { key, timer: undefined, running: false, next: undefined };
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      entry.running = true;
      act(code, entry, attempt)
        .catch((err) => logger.error({ err, roomCode: code }, "computer player failed"))
        .finally(() => {
          if (plans.get(code) !== entry) return;
          plans.delete(code);
          if (entry.next !== undefined) watch(entry.next);
        });
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
    const planned = plans.get(room.code);
    if (planned?.running) {
      // An older room that arrives late never replaces a newer one.
      if (!(room.version < planned.next?.version)) planned.next = room;
      return;
    }
    const action = botTurns.nextAction(room);
    if (action.kind === "none") {
      cancel(room.code);
      return;
    }
    if (planned?.key === action.key) return;
    cancel(room.code);
    plan(room.code, action.key, delayMs(action), 1);
  }

  /** The room as stored now, when the computer player still has the planned thing to do there. */
  async function stillPlanned(code, key) {
    const room = await roomComponent.getRoom(code);
    if (botTurns.nextAction(room).key === key) {
      return [room];
    }
    watch(room);
    return [];
  }

  /** Does the action, and answers the changed room. Answers none when the moment passed while it thought. */
  async function perform(room, action) {
    const input = { code: room.code, playerId: action.playerId, now: now() };
    if (action.kind === "rematch") {
      return [await botComponent.acceptRematch(input)];
    }
    if (action.kind === "answer") {
      return [await roomComponent.answerRequest({ ...input, ...action.reply })];
    }
    const turn = botTurns.turnFor(room, action.playerId);
    const move =
      turn.kind === "sealed" ? turn.move : await thinking.think({ room: room.code, request: turn.request });
    // Waiting for its turn to think may take a while: the person may have left or resigned meanwhile.
    const fresh = await stillPlanned(room.code, action.key);
    return Promise.all(fresh.map(() => roomComponent.makeMove({ ...input, now: now(), move })));
  }

  async function act(code, entry, attempt) {
    if (stopped) return;
    const { key } = entry;
    try {
      const [room] = await stillPlanned(code, key);
      if (room === undefined) {
        return;
      }
      const changed = await perform(room, botTurns.nextAction(room));
      // The person in the room only hears about it through this: nobody's socket made the change.
      changed.forEach((after) => events.emit(ROOM_EVENTS.UPDATED, { room: after }));
    } catch (err) {
      // The room changed while it acted: what to do next is planned from the room as it is now, at once.
      if (isGone(err) || entry.next !== undefined) return;
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

    /**
     * Plans for every stored room. Called at start up, and by the housekeeping sweep every minute in case a plan
     * was dropped. A room that already has the right plan keeps it, so calling this often changes nothing.
     */
    async resume() {
      for (const room of await roomAccessor.listAll()) {
        watch(room);
      }
    },

    /** Cancels every plan and every think waiting for a thread. Called when the server shuts down, before the database closes. */
    stop() {
      stopped = true;
      [...plans.keys()].forEach(cancel);
      thinking.stop();
    },
  });
}
