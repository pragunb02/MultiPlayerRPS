import { useState } from "react";
import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { Button } from "../Button/Button.jsx";
import styles from "./RematchPanel.module.css";

const names = (seats) => seats.map((seat) => seat.displayName).join(" and ");

/** "You 2 – 1 Bob" across the games played in this room. */
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
 * After a finished game: ask the same opponent for a rematch, accept theirs, or see that they left (CC-037).
 * The new game starts in this same room, so the page — and its URL — stay where they are.
 *
 * @param {{
 *   room: { gameId: string, you: string, seats: Array<{ playerId: string, displayName: string, connected: boolean }>,
 *     rematch?: { requestedBy: string[], available: boolean }, series?: { games: number, wins: Record<string, number> } },
 *   onRematch: () => Promise<unknown>,
 *   onError: (error: Error) => void,
 * }} props  `room` is the RoomView (SOCKET_EVENTS)
 */
export function RematchPanel({ room, onRematch, onError }) {
  const [busy, setBusy] = useState(false);
  if (room.rematch === undefined || room.you === "") {
    return null;
  }
  const opponents = room.seats.filter((seat) => seat.playerId !== room.you);
  const { requestedBy, available } = room.rematch;
  const youAsked = requestedBy.includes(room.you);
  const theyAsked = opponents.filter((seat) => requestedBy.includes(seat.playerId));
  const offline = opponents.filter((seat) => !seat.connected);

  async function toggle() {
    setBusy(true);
    try {
      await onRematch();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  let message;
  let action;
  if (!available) {
    message = "Opponent left — no rematch this time.";
    action = (
      <Link to={paths.game(room.gameId)} className={styles.link}>
        New game
      </Link>
    );
  } else if (youAsked) {
    message = `Waiting for ${names(opponents)}…`;
    action = (
      <Button variant="secondary" busy={busy} onClick={toggle}>
        Cancel rematch
      </Button>
    );
  } else if (theyAsked.length > 0) {
    message = `${names(theyAsked)} wants a rematch!`;
    action = (
      <Button size="lg" busy={busy} onClick={toggle} className={styles.invited}>
        Accept rematch
      </Button>
    );
  } else {
    message = "Fancy another round?";
    action = (
      <Button size="lg" busy={busy} onClick={toggle}>
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
      {available && offline.length > 0 && (
        <p className={styles.hint}>{names(offline)} is offline right now.</p>
      )}
      {action}
      <SeriesScore room={room} />
    </section>
  );
}
