import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

/**
 * The owner console's feature flags (CC-312): every flag with its rollouts and counts, and ways to set a rollout or
 * go back to the one in code. A change replaces that flag in the list with the server's answer.
 *
 * @returns {{
 *   status: "loading" | "ready" | "error",
 *   view: { source: string, days: number, countsRead: boolean, orphans: ReadonlyArray<object>, flags: ReadonlyArray<object> } | undefined,
 *   error: Error | undefined,
 *   retry: () => void,
 *   setRollout: (name: string, rollout: "off" | "on" | number) => Promise<void>,
 *   clearRollout: (name: string) => Promise<void>,
 * }}
 */
export function useAdminFlags() {
  const { api } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState({ attempt: -1, status: "loading", view: undefined, error: undefined });

  useEffect(() => {
    let cancelled = false;
    api.getAdminFlags().then(
      (view) => !cancelled && setShown({ attempt, status: "ready", view, error: undefined }),
      (error) => !cancelled && setShown({ attempt, status: "error", view: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  const replace = (flag) =>
    setShown((current) => ({
      ...current,
      view: {
        ...current.view,
        flags: current.view.flags.map((each) => (each.name === flag.name ? flag : each)),
      },
    }));

  const setRollout = useCallback(
    async (name, rollout) => replace(await api.setFlagRollout(name, rollout)),
    [api],
  );
  // A flag removed from the registry has no flag to answer with, so its override just leaves the list.
  const clearRollout = useCallback(
    async (name) => {
      const flag = await api.clearFlagRollout(name);
      if (flag !== undefined) {
        replace(flag);
        return;
      }
      setShown((current) => ({
        ...current,
        view: { ...current.view, orphans: current.view.orphans.filter((each) => each.name !== name) },
      }));
    },
    [api],
  );
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const current =
    shown.attempt === attempt ? shown : { status: "loading", view: undefined, error: undefined };
  return {
    status: current.status,
    view: current.view,
    error: current.error,
    retry,
    setRollout,
    clearRollout,
  };
}
