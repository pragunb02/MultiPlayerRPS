import { useCallback, useEffect, useRef, useState } from "react";

/** How long the reason stays on screen after a press, long enough to read a few words. */
export const EXPLAIN_FOR_MS = 2_500;

/**
 * Says why something cannot be pressed right now (CC-164). A press on a control that cannot act calls
 * `explain(reason)`, and `reason` holds the words for a moment. Every press counts up `count`, so pressing again
 * shows the reason again (and announces it again) even when the words are the same.
 *
 * @returns {{ reason: string, count: number, explain: (reason: string) => void }}
 */
export function useExplanation() {
  const [state, setState] = useState({ reason: "", count: 0 });
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const explain = useCallback((reason) => {
    setState((current) => ({ reason, count: current.count + 1 }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => setState((current) => ({ ...current, reason: "" })),
      EXPLAIN_FOR_MS,
    );
  }, []);

  return { ...state, explain };
}
