import { useCallback, useId, useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { incomingRequests, roomRequests } from "../../games/roomUpdates.js";
import { nameOf, opponentsOf } from "../../games/roomView.js";
import styles from "./RoomRequests.module.css";

/**
 * The question an opponent is waiting on, with Accept, Decline and Hide (CC-104). It sits in the page above the
 * board, never over it, so a phone shows every rank. It takes no focus: a player in the middle of a move keeps the
 * board, and keyboard play goes on. The question is announced when it appears, and Escape inside it puts it away
 * like Hide does.
 */
function RequestDialog({ request, room, onAnswer, onHide, busy }) {
  const titleId = useId();
  const questionId = useId();

  return (
    <section
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={questionId}
      onKeyDown={(event) => event.key === "Escape" && onHide(request.key)}
    >
      <h2 id={titleId} className={styles.title}>
        {request.title}
      </h2>
      <p id={questionId} className={styles.question} role="alert">
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
    </section>
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
