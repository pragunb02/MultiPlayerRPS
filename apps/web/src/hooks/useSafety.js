import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

/**
 * What the browser assumes until the server has answered, and if it cannot: the flags of an account of unknown age,
 * which are a minor's (ADR-028.1). A feature never gets more than the server allows, even for a moment.
 */
export const SAFEST_FLAGS = Object.freeze({
  canFollow: false,
  friendsMode: "mutual-known",
  emotes: "off",
  quietHours: Object.freeze({ timeZone: "Asia/Kolkata", from: "22:00", to: "07:00" }),
  shareCardName: false,
  maxOwnedCircleSize: 10,
  publicProfile: false,
  boardName: "hidden",
});

/**
 * The player's own safety flags, from the server's age policy (CC-152, `GET /api/safety`). Features in the browser
 * read these instead of working out an age.
 *
 * @returns {{ status: "loading" | "ready" | "error", safety: typeof SAFEST_FLAGS, reload: () => Promise<void> }}
 */
export function useSafety() {
  const { api } = useServices();
  const [state, setState] = useState({ status: "loading", safety: SAFEST_FLAGS });

  const load = useCallback(
    () =>
      api.getSafety().then(
        (safety) => ({ status: "ready", safety }),
        () => ({ status: "error", safety: SAFEST_FLAGS }),
      ),
    [api],
  );

  useEffect(() => {
    let cancelled = false;
    load().then((next) => !cancelled && setState(next));
    return () => {
      cancelled = true;
    };
  }, [load]);

  /** Reads the flags again, after something that changes them, such as setting the birth year. */
  const reload = useCallback(async () => setState(await load()), [load]);

  return { ...state, reload };
}
