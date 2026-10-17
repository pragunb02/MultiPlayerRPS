import { useCallback, useId, useState } from "react";
import { Link } from "react-router";
import { PRESENCE, ROOM_REQUEST_TYPES } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { incomingRequests, outgoingRequests } from "../../games/roomUpdates.js";
import { nameOf, seatOf } from "../../games/roomView.js";
import { useAction } from "../../hooks/useAction.js";
import { formatCountdown, useServerCountdown } from "../../hooks/useServerCountdown.js";
import { CATEGORIES } from "../../lib/notify/categories.js";
import { Button } from "../Button/Button.jsx";
import { DismissButton } from "../DismissButton/DismissButton.jsx";
import { useHold, useToast } from "../Toast/toastContext.js";
import { useRequestAnswers } from "./useRequestAnswers.js";
import styles from "./RequestBanner.module.css";

const noop = () => undefined;

/**
 * How long a request has left, as a bar and in minutes and seconds. Both change every second by themselves, so
 * they are marked as a ticker and never count as the answer to a press. The bar is a `<progress>`, so it needs no
 * inline style under the strict CSP.
 */
export function RequestCountdown({ request, serverTime }) {
  const left = useServerCountdown({ until: request.expiresAt, serverTime, onElapsed: noop });
  const total = Math.max(1, request.expiresAt - request.createdAt);
  return (
    <span className={styles.countdown} data-cc-ticker="">
      <progress className={styles.bar} max={total} value={left} aria-label="Time left to answer" />
      <span className={styles.time}>{formatCountdown(left)}</span>
    </span>
  );
}

/**
 * The choices for an asker whose opponent cannot answer: send them the room's link so they come back, find a new
 * opponent, or play the computer (CC-207). The computer opens the game's lobby, whose main button plays the
 * game's computer character at once (CC-221).
 */
function NoAnswerChoices({ room, onNewOpponent, reason }) {
  const toast = useToast();
  const link = `${window.location.origin}${paths.room(room.gameId, room.code)}`;
  const copy = useAction(
    async () => {
      try {
        await navigator.clipboard.writeText(link);
      } catch (cause) {
        throw new Error("Couldn't copy. Copy the address from the address bar", { cause });
      }
      toast.show("Link copied. Send it to bring them back", { tone: "success" });
    },
    { id: "request.copy_invite" },
  );
  return (
    <div className={styles.actions}>
      <Button control="request.copy_invite" variant="secondary" action={copy} doneLabel="Copied">
        Copy invite link
      </Button>
      <Button control="request.new_opponent" variant="secondary" action={onNewOpponent} reason={reason}>
        New opponent
      </Button>
      <Link to={paths.game(room.gameId)} className={styles.link} data-cc-control="request.play_computer">
        Play vs computer
      </Link>
    </div>
  );
}

/**
 * A question the opponent is waiting on, with Accept, Decline and Hide (CC-104, CC-160). It takes no focus: a
 * player in the middle of a move keeps the board, and keyboard play goes on. The question is announced at once,
 * and Escape inside it puts it away like Hide does.
 */
function Incoming({ request, room, onAction, onHide, reason }) {
  const titleId = useId();
  const questionId = useId();
  const accept = useAction(() => onAction(request.accept), { id: "room.request.accept" });
  const decline = useAction(() => onAction(request.decline), { id: "room.request.decline" });
  // While one answer is on its way the other cannot be sent as well.
  const answering = accept.busy || decline.busy ? "Sending your answer" : "";

  return (
    <section
      className={`${styles.request} ${styles.incoming}`}
      aria-labelledby={titleId}
      aria-describedby={questionId}
      onKeyDown={(event) => event.key === "Escape" && onHide(request.key)}
    >
      <h2 id={titleId} className={styles.title}>
        {request.texts.title}
      </h2>
      <p id={questionId} className={styles.text} role="alert">
        {request.texts.question(nameOf(room, request.from))}
      </p>
      <RequestCountdown request={request} serverTime={room.serverTime} />
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

/** Where the opponent is, in a sentence for the asker while they wait (CC-207). Empty while they are here. */
function whereabouts(room, request) {
  const seat = seatOf(room, request.to);
  const name = nameOf(room, request.to);
  if (seat?.presence === PRESENCE.OFFLINE) return `${name} is offline right now, so they cannot answer yet.`;
  if (seat?.presence === PRESENCE.AWAY) return `${name} is on another page. They have been told.`;
  return "";
}

/** The request the viewer asked, with how long it has left and Cancel (CC-160). */
function Outgoing({ request, room, onAction, onNewOpponent, reason }) {
  const cancel = useAction(() => onAction(request.cancel), { id: "room.request.cancel" });
  const where = whereabouts(room, request);
  const offline = seatOf(room, request.to)?.presence === PRESENCE.OFFLINE;
  return (
    <section className={`${styles.request} ${styles.outgoing}`} aria-label={request.texts.waitingTitle}>
      <p role="status" className={styles.text}>
        <strong>{request.texts.waiting(nameOf(room, request.to))}</strong>
        {where !== "" && <span className={styles.where}> {where}</span>}
      </p>
      <RequestCountdown request={request} serverTime={room.serverTime} />
      <div className={styles.actions}>
        <Button control="room.request.cancel" variant="secondary" action={cancel} reason={reason}>
          Cancel
        </Button>
      </div>
      {offline && request.type === ROOM_REQUEST_TYPES.REMATCH && (
        <NoAnswerChoices room={room} onNewOpponent={onNewOpponent} reason={reason} />
      )}
    </section>
  );
}

/** How a request ended, for a few seconds, or with its choices until put away (CC-160, CC-207). */
function Answer({ answer, room, onNewOpponent, onDismiss, reason }) {
  return (
    <section className={`${styles.request} ${styles.answer}`} aria-label="Answer">
      <p role="status" className={styles.text}>
        <strong>{answer.message}</strong>
      </p>
      {answer.lasting && (
        <>
          <NoAnswerChoices room={room} onNewOpponent={onNewOpponent} reason={reason} />
          <DismissButton control="request.dismiss" label="Close" onClick={() => onDismiss(answer.key)} />
        </>
      )}
    </section>
  );
}

/**
 * The request banner at the top of a room (CC-160, ADR-020): the question the opponent asked, with Accept and
 * Decline and how long is left, or the viewer's own question with Cancel while they wait, and then how it ended,
 * shown to both players. It sits in the page above the board and never over it, so a phone still shows every
 * square. While a request is open, reward toasts wait their turn (CC-208). Everything comes from the RoomView,
 * so it is the same after a reload.
 *
 * @param {{
 *   room: any,
 *   onAction: (action: import("../../games/roomUpdates.js").RoomAction) => Promise<unknown>,
 *   onNewOpponent: ReturnType<typeof useAction>,
 *   reason?: string,
 * }} props  `room` is the RoomView. `onNewOpponent` leaves the room for the lobby. `reason`: why no answer can be
 *   sent now, such as "Reconnecting", empty when it can
 */
export function RequestBanner({ room, onAction, onNewOpponent, reason = "" }) {
  const incoming = incomingRequests(room);
  const outgoing = outgoingRequests(room);
  const { answers, dismiss } = useRequestAnswers(room);
  const [hidden, setHidden] = useState([]);
  const hide = useCallback((key) => setHidden((current) => [...current, key]), []);
  const shown = incoming.filter((request) => !hidden.includes(request.key));
  useHold(CATEGORIES.REQUEST, incoming.length + outgoing.length > 0);

  if (shown.length + outgoing.length + answers.length === 0) {
    return null;
  }
  return (
    <div className={styles.banner}>
      {shown.map((request) => (
        <Incoming
          key={request.key}
          request={request}
          room={room}
          reason={reason}
          onAction={onAction}
          onHide={hide}
        />
      ))}
      {outgoing.map((request) => (
        <Outgoing
          key={request.key}
          request={request}
          room={room}
          onAction={onAction}
          onNewOpponent={onNewOpponent}
          reason={reason}
        />
      ))}
      {answers.map((answer) => (
        <Answer
          key={answer.key}
          answer={answer}
          room={room}
          onNewOpponent={onNewOpponent}
          onDismiss={dismiss}
          reason={reason}
        />
      ))}
    </div>
  );
}
