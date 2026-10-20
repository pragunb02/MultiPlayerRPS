import styles from "./TurnBanner.module.css";

/**
 * On one phone both players read the same screen, so "Your turn" could be either of them. The banner names the
 * player who holds the phone instead (CC-223).
 */
const sharedScreenText = (room) =>
  `${room.seats.find((seat) => seat.playerId === room.you).displayName}'s turn`;

/**
 * Whose turn it is, read out when it changes. It wears the design contract's player colours (CC-314): "you" when it
 * is the viewer's turn, "opponent" while they wait for someone else, and neither for a spectator. The word and the
 * seat marker's dot always come with the colour.
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
  const text = room.sharedScreen
    ? sharedScreenText(room)
    : yourTurn
      ? "Your turn"
      : `Waiting for ${waitingFor.map((seat) => seat.displayName).join(" and ") || "the other player"}`;
  const turn = yourTurn ? "you" : room.you === "" ? "watching" : "opponent";
  return (
    <p className={`${styles.banner} ${styles[turn] ?? ""}`} data-turn={turn} aria-live="polite">
      {text}
    </p>
  );
}
