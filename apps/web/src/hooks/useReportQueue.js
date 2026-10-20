import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

const LOADING = Object.freeze({ status: "loading", groups: Object.freeze([]), error: undefined });

/**
 * The owner console's report queue for one status (CC-044, ADR-071): the groups, one per reported player, and a way
 * to act on one. A result belongs to the status it answered, so a new status never shows the old list.
 *
 * @param {string | undefined} status  a REPORT_STATUSES value, open when left out
 * @returns {{
 *   status: "loading" | "ready" | "error",
 *   groups: ReadonlyArray<object>,
 *   error: Error | undefined,
 *   retry: () => void,
 *   act: (groupId: string, action: string) => Promise<{ closed: number, displayName?: string }>,
 * }}
 */
export function useReportQueue(status) {
  const { api } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", ...LOADING });
  const key = JSON.stringify([status ?? "", attempt]);

  useEffect(() => {
    let cancelled = false;
    api.getReportQueue(status === undefined ? {} : { status }).then(
      (groups) => !cancelled && setResult({ key, status: "ready", groups, error: undefined }),
      (error) => !cancelled && setResult({ key, ...LOADING, status: "error", error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, status, key]);

  const current = result.key === key ? result : LOADING;

  /** Acts on a group, and takes it off this list: its reports are closed now. */
  const act = useCallback(
    async (groupId, action) => {
      const done = await api.actOnReports(groupId, action);
      setResult((shown) => ({ ...shown, groups: shown.groups.filter((group) => group.groupId !== groupId) }));
      return done;
    },
    [api],
  );

  return { ...current, retry: () => setAttempt((n) => n + 1), act };
}
