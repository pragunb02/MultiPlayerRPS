import { useCallback, useId, useState } from "react";
import { Button } from "../../components/Button/Button.jsx";
import { incomingRequests, roomRequests } from "../../games/roomUpdates.js";
import { nameOf, opponentsOf } from "../../games/roomView.js";
import { useAction } from "../../hooks/useAction.js";
import styles from "./RoomRequests.module.css";

/**
 * The question an opponent is waiting on, with Accept, Decline and Hide (CC-104). It sits in the page above the
 * board, never over it, so a phone shows every rank. It takes no focus: a player in the middle of a move keeps the
 * board, and keyboard play goes on. The question is announced when it appears, and Escape inside it puts it away
 * like Hide does. Accept and Decline each show their own wait and their own failure (CC-164).
 */
function RequestDialog({ request, room, onAction, onHide, reason }) {
  const titleId = useId();
  const questionId = useId();
  const accept = useAction(() => onAction(request.accept), { id: "room.request.accept" });
  const decline = useAction(() => onAction(request.decline), { id: "room.request.decline" });
  // While one answer is on its way the other cannot be sent as well.
  const answering = accept.busy || decline.busy ? "Sending your answer" : "";

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
        <Button
          control="room.request.accept"
          action={accept}
          reason={reason || (decline.busy ? answering : "")}
        >
          Accept
        </Button>
        <Button
          control="room.request.decline"
          variant="secondary"
          action={decline}
          reason={reason || (accept.busy ? answering : "")}
        >
          Decline
        </Button>
        <Button control="room.request.hide" variant="ghost" onClick={() => onHide(request.key)}>
          Hide
        </Button>
      </div>
    </section>
  );
}

/**
 * The card a player sees after asking something, with Cancel (CC-104).
 */
function WaitingCard({ request, room, onAction, reason }) {
  const cancel = useAction(() => onAction(request.cancel), { id: "room.request.cancel" });
  return (
    <section className={styles.waiting} aria-label={request.waitingTitle}>
      <p role="status" className={styles.question}>
        <strong>{request.waitingTitle}.</strong> Waiting for {opponentsOf(room)}…
      </p>
      <Button control="room.request.cancel" variant="secondary" action={cancel} reason={reason}>
        Cancel
      </Button>
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
 *   reason?: string,
 * }} props  `room` is the RoomView (SOCKET_EVENTS). `reason`: why no answer can be sent now, such as
 *   "Reconnecting", empty when it can
 */
export function RoomRequests({ room, onAction, reason = "" }) {
  const incoming = incomingRequests(room);
  const keys = incoming.map((request) => request.key).join(" ");
  const [hidden, setHidden] = useState({ keys, list: [] });
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

  return (
    <>
      {waiting.map((request) => (
        <WaitingCard key={request.key} request={request} room={room} onAction={onAction} reason={reason} />
      ))}
      {shown && (
        <RequestDialog
          key={shown.key}
          request={shown}
          room={room}
          reason={reason}
          onAction={onAction}
          onHide={hide}
        />
      )}
    </>
  );
}
