import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";
import { useSession } from "./useSession.js";

const LOADING = Object.freeze({ status: "loading", data: undefined, error: undefined });

/**
 * One leaderboard: its period, the top entries and — with a session — where you stand. Loads once the session is
 * known (so `you` matches who you are) and again for another board or whenever you become someone else. A result
 * belongs to the request it answered, so switching boards never shows the previous board's entries.
 *
 * status: "loading" | "ready" | "error"
 *
 * @param {string} boardId
 * @param {{ limit?: number }} [options]
 */
export function useLeaderboard(boardId, { limit } = {}) {
  const { api } = useServices();
  const session = useSession();
  const [result, setResult] = useState({ key: "", ...LOADING });
  const [attempt, setAttempt] = useState(0);
  const sessionKnown = session.status !== "loading";
  const key = JSON.stringify([boardId, limit ?? 0, session.identity?.id ?? "", attempt]);

  useEffect(() => {
    if (!sessionKnown) {
      return undefined;
    }
    let cancelled = false;
    api.getLeaderboard(boardId, { limit }).then(
      (data) => !cancelled && setResult({ key, status: "ready", data, error: undefined }),
      (error) => !cancelled && setResult({ key, status: "error", data: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, boardId, limit, sessionKnown, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { status, data, error } = result.key === key ? result : LOADING;

  return { status, data, error, retry };
}
