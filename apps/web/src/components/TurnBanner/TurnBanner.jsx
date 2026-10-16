import styles from "./TurnBanner.module.css";

/**
 * Whose turn it is, announced to screen readers when it changes.
 *
 * @param {{ room: { you: string, status: string, seats: Array<{ playerId: string, displayName: string }>, game?: { activePlayers: string[] } } }} props
 */
export function TurnBanner({ room }) {
  if (room.status !== "playing" || room.game === undefined) {
    return null;
  }
  const active = room.game.activePlayers;
  const yourTurn = active.includes(room.you);
  const waitingFor = room.seats.filter(
    (seat) => active.includes(seat.playerId) && seat.playerId !== room.you,
  );
  const text = yourTurn
    ? "Your turn"
    : `Waiting for ${waitingFor.map((seat) => seat.displayName).join(" and ") || "the other player"}`;
  return (
    <p className={`${styles.banner} ${yourTurn ? styles.yours : ""}`} aria-live="polite">
      {text}
    </p>
  );
}
