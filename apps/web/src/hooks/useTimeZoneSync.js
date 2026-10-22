import { useEffect, useRef } from "react";
import { useServices } from "../app/servicesContext.js";
import { useFlag } from "./useFlag.js";
import { useSession } from "./useSession.js";

/** The browser's own time zone, such as "Asia/Kolkata", or "" when it does not say. */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";

/**
 * Tells the server the browser's time zone, so the player's days are their own (CC-146, ADR-077). Only with the
 * `local_days` flag on, at most once a visit for each player, and only when the server's zone is a different one.
 * A refusal (a change less than 7 days ago) is quiet: the server's zone stays, and the next visit asks again.
 *
 * @param {{ zoneOf?: () => string }} [options]  where the browser's zone comes from (tests give their own)
 */
export function useTimeZoneSync({ zoneOf = browserTimeZone } = {}) {
  const { api } = useServices();
  const session = useSession();
  const on = useFlag("local_days");
  const who = session.identity?.id ?? "";
  const asked = useRef(new Set());

  useEffect(() => {
    const zone = zoneOf();
    if (!on || who === "" || zone === "" || asked.current.has(who)) {
      return;
    }
    asked.current.add(who);
    api
      .getTimeZone()
      .then((current) => (current.zone === zone ? undefined : api.setTimeZone(zone)))
      .catch(() => undefined);
  }, [api, on, who, zoneOf]);
}
