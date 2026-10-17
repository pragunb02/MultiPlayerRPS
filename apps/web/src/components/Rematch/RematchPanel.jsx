import { useAction } from "../../hooks/useAction.js";
import { formatCountdown, useServerCountdown } from "../../hooks/useServerCountdown.js";
import { Button } from "../Button/Button.jsx";
import styles from "./RematchPanel.module.css";

const names = (seats) => seats.map((seat) => seat.displayName).join(" and ");

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

/**
 * After a finished game, at the top of the result: ask the same opponent for a rematch, accept theirs, see that
 * they declined (CC-104), or see that they left (CC-037, CC-162). Rematch is the main action of the result. The new
 * game starts in this same room, so the page and its URL stay where they are.
 *
 * @param {{
 *   room: { gameId: string, you: string, serverTime: number,
 *     seats: Array<{ playerId: string, displayName: string, connected: boolean }>,
 *     rematch?: { requestedBy: string[], available: boolean, until: number, declinedBy?: string, leftName?: string },
 *     series?: { games: number, wins: Record<string, number> } },
 *   onRematch: () => Promise<unknown>,
 *   onWindowEnded: () => void,
 *   reason?: string,
 * }} props  `room` is the RoomView (SOCKET_EVENTS). `reason`: why the button cannot be pressed now, such as
 *   "Reconnecting", empty when it can
 */
export function RematchPanel({ room, onRematch, onWindowEnded, reason = "" }) {
  const toggle = useAction(onRematch, { id: "room.rematch" });
  if (room.rematch === undefined || room.you === "") {
    return null;
  }
  const opponents = room.seats.filter((seat) => seat.playerId !== room.you);
  const { requestedBy, available } = room.rematch;
  const youAsked = requestedBy.includes(room.you);
  const theyAsked = opponents.filter((seat) => requestedBy.includes(seat.playerId));
  const offline = opponents.filter((seat) => !seat.connected);

  let message;
  let action = null;
  if (!available) {
    message = leftText(room);
  } else if (youAsked) {
    message = `Waiting for ${names(opponents)}…`;
    action = (
      <Button control="room.rematch.cancel" variant="secondary" action={toggle} reason={reason}>
        Cancel rematch
      </Button>
    );
  } else if (theyAsked.length > 0) {
    message = `${names(theyAsked)} wants a rematch!`;
    action = (
      <Button
        control="room.rematch.accept"
        size="lg"
        action={toggle}
        reason={reason}
        className={styles.invited}
      >
        Accept rematch
      </Button>
    );
  } else {
    // After a "no" the panel says so, and asking again stays possible (CC-104).
    const declinedBy = room.rematch.declinedBy ?? "";
    if (declinedBy === room.you) {
      message = "You declined the rematch. Changed your mind?";
    } else if (declinedBy !== "") {
      message = `${names(opponents.filter((seat) => seat.playerId === declinedBy))} declined the rematch.`;
    } else {
      message = "Fancy another round?";
    }
    action = (
      <Button control="room.rematch.ask" size="lg" action={toggle} reason={reason}>
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
      {available && offline.length > 0 && (
        <p className={styles.hint}>{names(offline)} is offline right now.</p>
      )}
      {available && (
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
