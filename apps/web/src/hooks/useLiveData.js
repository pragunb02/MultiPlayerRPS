import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

/**
 * Server data that the server also pushes changes to: loaded once, then kept current by a socket event.
 * A push that arrives before the first load finished is dropped — the load already reflects it.
 *
 * status: "loading" | "ready" | "error"
 *
 * @template T, P
 * @param {{
 *   load: () => Promise<T>,
 *   event: string,                          SOCKET_EVENTS value
 *   merge: (current: T, payload: P) => T,   module-level (stable) function
 * }} options
 * @returns {{ status: string, data: T | undefined, error: Error | undefined, retry: () => void }}
 */
export function useLiveData({ load, event, merge }) {
  const { socket } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: "loading", data: undefined, error: undefined });

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => !cancelled && setState({ status: "ready", data, error: undefined }),
      (error) => !cancelled && setState({ status: "error", data: undefined, error }),
    );
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  useEffect(
    () =>
      socket.on(event, (payload) =>
        setState((current) =>
          current.status === "ready" ? { ...current, data: merge(current.data, payload) } : current,
        ),
      ),
    [socket, event, merge],
  );

  const retry = useCallback(() => {
    setState({ status: "loading", data: undefined, error: undefined });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
