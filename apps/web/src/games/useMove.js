import { useCallback, useState } from "react";

/**
 * Sends moves for a board and keeps the last rejection to show (e.g. "That cell is taken").
 *
 * @param {(move: unknown) => Promise<unknown>} onMove
 */
export function useMove(onMove) {
  const [state, setState] = useState({ busy: false, error: "" });

  const send = useCallback(
    async (move) => {
      setState({ busy: true, error: "" });
      try {
        await onMove(move);
        setState({ busy: false, error: "" });
      } catch (err) {
        setState({ busy: false, error: err.message });
      }
    },
    [onMove],
  );

  return { ...state, send };
}
