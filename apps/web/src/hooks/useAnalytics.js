import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

const LOADING = Object.freeze({ status: "loading", report: undefined, error: undefined });

/**
 * The owner console's report for one range (CC-233). A result belongs to the range it answered, so changing the
 * range never shows the previous range's numbers, even for a moment.
 *
 * status: "loading" | "ready" | "error"
 *
 * @param {{ from?: string, to?: string, bucket?: string }} range  all omitted means the server's default range
 */
export function useAnalytics({ from, to, bucket }) {
  const { api } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", ...LOADING });
  const key = JSON.stringify([from ?? "", to ?? "", bucket ?? "", attempt]);

  useEffect(() => {
    let cancelled = false;
    api.getAnalytics({ from, to, bucket }).then(
      (report) => !cancelled && setResult({ key, status: "ready", report, error: undefined }),
      (error) => !cancelled && setResult({ key, status: "error", report: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, from, to, bucket, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { status, report, error } = result.key === key ? result : LOADING;
  return { status, report, error, retry };
}
