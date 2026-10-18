import { PRESENCE, REQUEST_ANSWERS, REQUEST_STATES, ROOM_REQUEST_TYPES } from "@classicade/shared";
import { useAskReason } from "../../games/useAskReason.js";
import { useAction } from "../../hooks/useAction.js";
import { formatCountdown, useServerCountdown } from "../../hooks/useServerCountdown.js";
import { Button } from "../Button/Button.jsx";
import styles from "./RematchPanel.module.css";

const REMATCH = ROOM_REQUEST_TYPES.REMATCH;
const names = (seats) => seats.map((seat) => seat.displayName).join(" and ");
const ASK = Object.freeze({ type: "ask", requestType: REMATCH });
const ACCEPT = Object.freeze({ type: "answer", requestType: REMATCH, answer: REQUEST_ANSWERS.ACCEPT });
const WITHDRAW = Object.freeze({ type: "answer", requestType: REMATCH, answer: REQUEST_ANSWERS.WITHDRAW });

/** The series score, such as `You 2 – 1 Bob`, across the games played in this room. */
function SeriesScore({ room }) {
  if (room.series === undefined || room.series.games < 2) {
    return null;
  }
  const score = room.seats
    .map(
      (seat) =>
        `${seat.playerId === room.you ? "You" : seat.displayName} ${room.series.wins[seat.playerId] ?? 0}`,
    )
    .join(" – ");
  return (
    <p className={styles.series}>
      Series after {room.series.games} games: <strong>{score}</strong>
    </p>
  );
}

/**
 * How long a rematch is still possible. The room closes when the time is up (CC-101), and `onWindowEnded` lets
 * the page find out at that moment instead of showing 0:00. The text is not announced: it changes every second.
 * It is marked as a ticker, so its changes never count as the answer to a press.
 */
function RematchWindow({ until, serverTime, onWindowEnded }) {
  const left = useServerCountdown({ until, serverTime, onElapsed: onWindowEnded });
  return (
    <p className={styles.hint}>
      Rematch available for{" "}
      <span className={styles.countdown} data-cc-ticker="">
        {formatCountdown(left)}
      </span>
    </p>
  );
}

/** Who left the finished game, by name when the room still knows it (CC-162). */
const leftText = (room) =>
  room.rematch.leftName
    ? `${room.rematch.leftName} left, so there is no rematch this time.`
    : "Your opponent left, so there is no rematch this time.";

/** The last rematch request of this room the server still keeps, open or just ended. */
const lastRematch = (room) => (room.requests ?? []).findLast((request) => request.type === REMATCH);

/**
 * After a finished game, at the top of the result: ask the same opponent for a rematch, accept theirs, see that
 * they declined or did not answer (CC-104, CC-159), or see that they left (CC-037, CC-162). Rematch is the main
 * action of the result. The new game starts in this same room, so the page and its URL stay where they are.
 *
 * @param {{
 *   room: any,
 *   onAction: (action: import("../../games/roomUpdates.js").RoomAction) => Promise<unknown>,
 *   onWindowEnded: () => void,
 *   reason?: string,
 * }} props  `room` is the RoomView (SOCKET_EVENTS). `reason`: why the button cannot be pressed now, such as
 *   "Reconnecting", empty when it can
 */
export function RematchPanel({ room, onAction, onWindowEnded, reason = "" }) {
  const ask = useAction(() => onAction(ASK), { id: "room.rematch.ask" });
  const accept = useAction(() => onAction(ACCEPT), { id: "room.rematch.accept" });
  const cancel = useAction(() => onAction(WITHDRAW), { id: "room.rematch.cancel" });
  // Right after a "no" asking again waits a moment (CC-159). The reason says so and goes by itself.
  const cooldown = useAskReason(room, REMATCH);
  if (room.rematch === undefined || room.you === "") {
    return null;
  }
  const opponents = room.seats.filter((seat) => seat.playerId !== room.you);
  const last = lastRematch(room);
  const open = last?.state === REQUEST_STATES.OPEN;
  const offline = opponents.filter((seat) => seat.presence === PRESENCE.OFFLINE);

  let message;
  let action = null;
  if (!room.rematch.available) {
    message = leftText(room);
  } else if (open && last.from === room.you) {
    message = `Waiting for ${names(opponents)}…`;
    action = (
      <Button control="room.rematch.cancel" variant="secondary" action={cancel} reason={reason}>
        Cancel rematch
      </Button>
    );
  } else if (open) {
    message = `${names(opponents)} wants a rematch!`;
    action = (
      <Button
        control="room.rematch.accept"
        size="lg"
        action={accept}
        reason={reason}
        className={styles.invited}
      >
        Accept rematch
      </Button>
    );
  } else {
    // After a "no" or no answer the panel says so, and asking again stays possible (CC-104).
    if (last?.state === REQUEST_STATES.DECLINED) {
      message =
        last.to === room.you
          ? "You declined the rematch. Changed your mind?"
          : `${names(opponents)} declined the rematch.`;
    } else if (last?.state === REQUEST_STATES.EXPIRED && last.from === room.you) {
      message = `No answer from ${names(opponents)}.`;
    } else {
      message = "Fancy another round?";
    }
    action = (
      <Button control="room.rematch.ask" size="lg" action={ask} reason={reason || cooldown}>
        Rematch
      </Button>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="rematch-heading">
      <h2 id="rematch-heading" className="visually-hidden">
        Rematch
      </h2>
      <p className={styles.message} role="status">
        {message}
      </p>
      {action}
      {room.rematch.available && offline.length > 0 && (
        <p className={styles.hint}>{names(offline)} is offline right now.</p>
      )}
      {room.rematch.available && (
        <RematchWindow
          until={room.rematch.until}
          serverTime={room.serverTime}
          onWindowEnded={onWindowEnded}
        />
      )}
      <SeriesScore room={room} />
    </section>
  );
}
