import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

const LOADING = Object.freeze({
  status: "loading",
  items: Object.freeze([]),
  next: undefined,
  error: undefined,
});

/**
 * The owner console's feedback inbox for some filters (CC-290): the items, newest first, older pages on request, and
 * a way to change an item's status. A result belongs to the filters it answered, so new filters never show the old
 * list, even for a moment.
 *
 * @param {{ type?: string, status?: string }} filters  each left out for all
 * @returns {{
 *   status: "loading" | "ready" | "error",
 *   items: ReadonlyArray<object>,
 *   next: string | undefined,
 *   error: Error | undefined,
 *   retry: () => void,
 *   loadOlder: () => Promise<void>,
 *   setStatus: (feedbackId: string, status: string) => Promise<void>,
 * }}
 */
export function useFeedbackInbox({ type, status }) {
  const { api } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: "", ...LOADING });
  const key = JSON.stringify([type ?? "", status ?? "", attempt]);
  const query = JSON.stringify({ type, status });

  useEffect(() => {
    let cancelled = false;
    api.getFeedbackInbox(JSON.parse(query)).then(
      ({ items, next }) => !cancelled && setResult({ key, status: "ready", items, next, error: undefined }),
      (error) => !cancelled && setResult({ key, ...LOADING, status: "error", error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, query, key]);

  const current = result.key === key ? result : LOADING;

  const loadOlder = useCallback(async () => {
    const { items, next } = await api.getFeedbackInbox({ ...JSON.parse(query), before: current.next });
    setResult((shown) => ({ ...shown, items: [...shown.items, ...items], next }));
  }, [api, query, current.next]);

  const setStatus = useCallback(
    async (feedbackId, next) => {
      const changed = await api.setFeedbackStatus(feedbackId, next);
      setResult((shown) => ({
        ...shown,
        items: shown.items.map((each) => (each.feedbackId === feedbackId ? changed : each)),
      }));
    },
    [api],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { items, next, error } = current;
  return { status: current.status, items, next, error, retry, loadOlder, setStatus };
}
