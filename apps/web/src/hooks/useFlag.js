import { useEffect, useState, useSyncExternalStore } from "react";
import { assertClientFlag, flagNamed } from "@classicade/shared";
import { flagStoreFor } from "../app/flagStore.js";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/**
 * Whether a feature flag is on for the person using the app (CC-312, ADR-073). The server works it out and answers
 * only `true` or `false`. Until it answers, and when the question fails, the flag is off, so a feature behind it
 * never shows by mistake. The app asks once per person for every client flag and keeps the answers
 * (`app/flagStore.js`, CC-349), so a page that opens later knows at once.
 *
 * Write the name out in full as a quoted string, so the tests that read the source can find it.
 *
 * @param {string} name  a flag in packages/shared/src/flags.js that is marked `client`
 * @returns {boolean}
 * @throws {RangeError} for a name that is not registered, or a flag only the server may read
 */
export function useFlag(name) {
  return useFlagState(name) === FLAG_STATES.ON;
}

/** Where the answer about a flag stands: not answered yet for this person, on or off. */
export const FLAG_STATES = Object.freeze({ UNKNOWN: "unknown", ON: "on", OFF: "off" });

/**
 * The same question as `useFlag`, for code that must tell "not answered yet" from "off", such as usage counts
 * (CC-174), which hold the first events of a page until the answer comes. A failed question is off.
 *
 * @param {string} name  a flag in packages/shared/src/flags.js that is marked `client`
 * @returns {string} a FLAG_STATES value
 * @throws {RangeError} for a name that is not registered, or a flag only the server may read
 */
export function useFlagState(name) {
  assertClientFlag(flagNamed(name));
  const { api } = useServices();
  const session = useSession();
  const store = flagStoreFor(api);
  const who = session.identity?.id ?? "";
  const settled = session.status !== "loading";

  // Asked once the app knows who this is, so a returning player is not asked about as a visitor first.
  useEffect(() => {
    if (settled) store.load(who);
  }, [store, who, settled]);

  return useSyncExternalStore(store.subscribe, () =>
    settled ? store.stateOf(who, name) : FLAG_STATES.UNKNOWN,
  );
}

/**
 * The state of a flag for a layout: "unknown" only until the first answer, then the latest answer. A page that
 * waits for the answer before drawing what the flag changes uses it, so the page does not move when the player
 * changes (a visitor who becomes a guest) and the new person's answer is on its way (CC-349).
 *
 * @param {string} name  a flag in packages/shared/src/flags.js that is marked `client`
 * @returns {string} a FLAG_STATES value
 */
export function useSteadyFlagState(name) {
  const state = useFlagState(name);
  const [last, setLast] = useState(FLAG_STATES.UNKNOWN);
  if (state !== FLAG_STATES.UNKNOWN && state !== last) setLast(state);
  return state === FLAG_STATES.UNKNOWN ? last : state;
}
