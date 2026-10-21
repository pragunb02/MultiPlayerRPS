import { useCallback, useEffect, useState } from "react";
import { REPORT_STATUS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";

const LOADING = Object.freeze({
  status: "loading",
  groups: Object.freeze([]),
  total: 0,
  page: 0,
  more: false,
  error: undefined,
});

/**
 * One page of the owner console's report queue for one status (CC-044, ADR-071): the groups, one per reported
 * player, how many there are, and a way to act on one. A result belongs to the status and page it answered, so a new
 * one never shows the old list.
 *
 * @param {{ status?: string, page?: string }} query  a REPORT_STATUSES value, open when left out, and the page from 0
 * @returns {{
 *   status: "loading" | "ready" | "error",
 *   groups: ReadonlyArray<object>,
 *   total: number,
 *   page: number,
 *   more: boolean,
 *   error: Error | undefined,
 *   retry: () => void,
 *   act: (groupId: string, action: string) => Promise<{ closed: number, displayName?: string }>,
 *   suspend: (groupId: string, choice: { duration: string, reason: string }) => Promise<{ suspension: object, closed: number }>,
 * }}
 */
export function useReportQueue({ status, page }) {
  const { api } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", ...LOADING });
  const key = JSON.stringify([status ?? "", page ?? "", attempt]);
  const query = JSON.stringify({ status, page });

  useEffect(() => {
    let cancelled = false;
    api.getReportQueue(JSON.parse(query)).then(
      (answer) => !cancelled && setResult({ key, status: "ready", ...answer, error: undefined }),
      (error) => !cancelled && setResult({ key, ...LOADING, status: "error", error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, query, key]);

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

  /**
   * Suspends a group's account (CC-334). Its open reports close, so an open group leaves this list; on the other
   * statuses the group stays, since its reports were closed already.
   */
  const suspend = useCallback(
    async (groupId, choice) => {
      const done = await api.suspendAccount(groupId, choice);
      if ((status ?? REPORT_STATUS.OPEN) === REPORT_STATUS.OPEN) {
        setResult((shown) => ({
          ...shown,
          groups: shown.groups.filter((group) => group.groupId !== groupId),
        }));
      }
      return done;
    },
    [api, status],
  );

  return { ...current, retry: () => setAttempt((n) => n + 1), act, suspend };
}
