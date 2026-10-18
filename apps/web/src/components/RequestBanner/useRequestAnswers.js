import { useCallback, useEffect, useRef, useState } from "react";
import { REQUEST_STATES, ROOM_REQUEST_TYPES } from "@classicade/shared";
import { requestAnswers } from "../../games/roomUpdates.js";

/** How long an answer stays on screen for both players (CC-160). */
export const ANSWER_SHOWN_MS = 4_000;

/**
 * Whether an answer stays until the player puts it away: a rematch the asker got no answer to comes with choices
 * (copy the link, a new opponent, a computer), and a choice needs time.
 */
const staysUntilDismissed = (answer) =>
  answer.asked && answer.state === REQUEST_STATES.EXPIRED && answer.type === ROOM_REQUEST_TYPES.REMATCH;

/**
 * How the requests the viewer was part of ended, as they happen (CC-160): each answer shows for four seconds, and a
 * rematch nobody answered stays with its choices until dismissed. Worked out from each new RoomView compared with
 * the one before, so a reload is not news.
 *
 * @param {any} room  the RoomView
 * @param {{ shownMs?: number }} [options]
 * @returns {{ answers: Array<import("../../games/roomUpdates.js").RequestAnswer & { lasting: boolean }>, dismiss: (key: string) => void }}
 */
export function useRequestAnswers(room, { shownMs = ANSWER_SHOWN_MS } = {}) {
  const [answers, setAnswers] = useState([]);
  const previous = useRef(room);
  const timers = useRef(new Set());

  const dismiss = useCallback(
    (key) => setAnswers((current) => current.filter((each) => each.key !== key)),
    [],
  );

  useEffect(() => {
    const before = previous.current;
    previous.current = room;
    if (before === room) return;
    const fresh = requestAnswers(before, room).map((answer) => ({
      ...answer,
      lasting: staysUntilDismissed(answer),
    }));
    if (fresh.length === 0) return;
    // A new answer replaces an older one about the same kind of request.
    setAnswers((current) => [
      ...current.filter((each) => !fresh.some((answer) => answer.type === each.type)),
      ...fresh,
    ]);
    fresh
      .filter((answer) => !answer.lasting)
      .forEach((answer) => {
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          dismiss(answer.key);
        }, shownMs);
        timers.current.add(timer);
      });
  }, [room, dismiss, shownMs]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  return { answers, dismiss };
}
