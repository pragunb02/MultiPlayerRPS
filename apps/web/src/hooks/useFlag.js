import { useEffect, useState } from "react";
import { assertClientFlag, flagNamed } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

/**
 * Whether a feature flag is on for the person using the app (CC-312, ADR-073). The server works it out and answers
 * only `true` or `false`. Until it answers, and when the question fails, the flag is off, so a feature behind it
 * never shows by mistake. The question is asked again whenever the person changes.
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
  const who = session.identity?.id ?? "";
  const [answer, setAnswer] = useState({ who: undefined, on: false });

  useEffect(() => {
    let cancelled = false;
    api.getFlags([name]).then(
      (flags) => !cancelled && setAnswer({ who, on: flags[name] === true }),
      () => !cancelled && setAnswer({ who, on: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, name, who]);

  if (answer.who !== who) return FLAG_STATES.UNKNOWN;
  return answer.on ? FLAG_STATES.ON : FLAG_STATES.OFF;
}
