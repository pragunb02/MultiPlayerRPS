import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

const LOADING = Object.freeze({ status: "loading", report: undefined, error: undefined });
const OFF = Object.freeze({ status: "off", report: undefined, error: undefined });

/**
 * One section of the owner's UX page for a range (CC-177). A result belongs to the section and range it answered,
 * so changing either never shows the previous numbers, even for a moment. While `enabled` is false nothing is asked.
 *
 * status: "off" | "loading" | "ready" | "error"
 *
 * @param {{ section: string, from?: string, to?: string, enabled?: boolean }} query
 */
export function useUxReport({ section, from, to, enabled = true }) {
  const { api } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", ...LOADING });
  const key = JSON.stringify([section, from ?? "", to ?? "", attempt]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    api.getUxReport({ section, from, to }).then(
      (report) => !cancelled && setResult({ key, status: "ready", report, error: undefined }),
      (error) => !cancelled && setResult({ key, status: "error", report: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, section, from, to, key, enabled]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!enabled) return { ...OFF, retry };
  const { status, report, error } = result.key === key ? result : LOADING;
  return { status, report, error, retry };
}
