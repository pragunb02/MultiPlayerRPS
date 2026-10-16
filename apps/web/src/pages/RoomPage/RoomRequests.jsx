import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { incomingRequests, roomRequests } from "../../games/roomUpdates.js";
import { nameOf, opponentsOf } from "../../games/roomView.js";
import styles from "./RoomRequests.module.css";

/**
 * The question an opponent is waiting on, as a popup with Accept and Decline (CC-104). It does not cover the page
 * with a backdrop, so the board stays usable, and Hide (or Escape) puts it away until the next request. Focus moves
 * to it so keyboard and screen reader users hear the question at once, and goes back where it was afterwards.
 */
function RequestDialog({ request, room, onAnswer, onHide, busy }) {
  const box = useRef(null);
  const titleId = useId();
  const questionId = useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    box.current.querySelector("button").focus();
    const onKey = (event) => event.key === "Escape" && onHide(request.key);
    document.addEventListener("keydown", onKey);
    const dialog = box.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      // Give focus back only if it was still in the popup. A player who went back to the board keeps their place.
      const focused = document.activeElement;
      if (focused === null || focused === document.body || dialog.contains(focused)) {
        previouslyFocused?.focus?.();
      }
    };
  }, [request.key, onHide]);

  return (
    <div
      ref={box}
      className={styles.dialog}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={questionId}
    >
      <h2 id={titleId} className={styles.title}>
        {request.title}
      </h2>
      <p id={questionId} className={styles.question}>
        {request.question(nameOf(room, request.from))}
      </p>
      <div className={styles.actions}>
        <Button busy={busy} onClick={() => onAnswer(request.accept)}>
          Accept
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onAnswer(request.decline)}>
          Decline
        </Button>
        <Button variant="ghost" onClick={() => onHide(request.key)}>
          Hide
        </Button>
      </div>
    </div>
  );
}

/**
 * Requests between the players of a room (CC-104): the popup for a question someone asked you, and a waiting card
 * with Cancel for one you asked. Both are worked out from the RoomView, so they close by themselves the moment a
 * request is answered, withdrawn or no longer possible, and come back the same after a reload.
 *
 * @param {{
 *   room: any,
 *   onAction: (action: import("../../games/roomUpdates.js").RoomAction) => Promise<unknown>,
 *   onError: (error: Error) => void,
 * }} props  `room` is the RoomView (SOCKET_EVENTS)
 */
export function RoomRequests({ room, onAction, onError }) {
  const incoming = incomingRequests(room);
  const keys = incoming.map((request) => request.key).join(" ");
  const [hidden, setHidden] = useState({ keys, list: [] });
  const [busy, setBusy] = useState(false);
  const hide = useCallback(
    (key) => setHidden((current) => ({ ...current, list: [...current.list, key] })),
    [],
  );
  // Forget hidden requests once they are over, so a new offer later is shown even if it looks the same.
  if (hidden.keys !== keys) {
    const standing = new Set(incoming.map((request) => request.key));
    setHidden({ keys, list: hidden.list.filter((key) => standing.has(key)) });
  }
  const shown = incoming.find((request) => !hidden.list.includes(request.key));
  const waiting =
    room.you === ""
      ? []
      : roomRequests(room).filter((request) => request.from === room.you && request.showWaiting);

  async function run(action) {
    setBusy(true);
    try {
      await onAction(action);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {waiting.map((request) => (
        <section key={request.key} className={styles.waiting} aria-label={request.waitingTitle}>
          <p role="status" className={styles.question}>
            <strong>{request.waitingTitle}.</strong> Waiting for {opponentsOf(room)}…
          </p>
          <Button variant="secondary" busy={busy} onClick={() => run(request.cancel)}>
            Cancel
          </Button>
        </section>
      ))}
      {shown && (
        <RequestDialog key={shown.key} request={shown} room={room} busy={busy} onAnswer={run} onHide={hide} />
      )}
    </>
  );
}
