import { useCallback, useState } from "react";
import { useAction } from "../hooks/useAction.js";

const NOTHING_SENT = Object.freeze({ move: undefined });

/**
 * Sends moves for a board, with the feedback every press gets (CC-164). `sent` is the move on its way, so the
 * board can show it the moment it is pressed, before the server answers. `pending` turns true when the answer
 * takes longer than 400 ms, for a spinner, and stays true at least 300 ms. The last refusal stays in `error` (for example "That cell is taken")
 * until the next move, and `retry` sends the same move again when the failure was the connection.
 *
 * @param {(move: unknown) => Promise<unknown>} onMove
 * @param {{ id: string }} options  `id` names the board's controls, for example "ttt.cell"
 */
export function useMove(onMove, { id }) {
  const action = useAction(onMove, { id });
  const { run } = action;
  const [sent, setSent] = useState(NOTHING_SENT);

  const send = useCallback(
    async (move) => {
      setSent({ move });
      const result = await run(move);
      setSent(NOTHING_SENT);
      return result;
    },
    [run],
  );

  return {
    action,
    busy: action.busy,
    pending: action.phase === "pending",
    sent: sent.move,
    error: action.error?.message ?? "",
    send,
  };
}
