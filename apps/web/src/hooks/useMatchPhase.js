import { useContext, useLayoutEffect } from "react";
import { ServicesContext } from "../app/servicesContext.js";
import { NO_INTERRUPTIONS } from "../lib/telemetry/interruptions.js";

const SEATED = Object.freeze(["waiting", "my-turn", "their-turn"]);
const LINK_ENTRIES = Object.freeze(["room_link", "shared_link"]);

/**
 * Tells the interruption counts where the match stands (CC-313): a game starts when play starts and is counted when
 * its result shows, and a seat in the room is the funnels' `seated` step. Leaving the room leaves the game. A layout
 * effect, so the phase is set before any surface drawn in the same step (the result's save progress card) opens.
 *
 * @param {string} phase  `matchPhase(room)`
 * @param {string} gameId
 */
export function useMatchPhase(phase, gameId) {
  const services = useContext(ServicesContext);
  const tracker = services?.interruptions ?? NO_INTERRUPTIONS;
  const entry = services?.telemetry?.landing.entry;
  useLayoutEffect(() => {
    tracker.notePhase(phase, gameId);
    if (SEATED.includes(phase)) {
      tracker.reach("visit_to_play", "seated");
      if (LINK_ENTRIES.includes(entry)) tracker.reach("link_to_seat", "seated");
    }
  }, [tracker, phase, gameId, entry]);
  useLayoutEffect(() => () => tracker.notePhase(undefined), [tracker]);
}
