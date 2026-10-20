import styles from "./TurnBanner.module.css";
import { useInterruption } from "../../hooks/useInterruption.js";

/**
 * On one phone both players read the same screen, so "Your turn" could be either of them. The banner names the
 * player who holds the phone instead (CC-223).
 */
const sharedScreenText = (room) =>
  `${room.seats.find((seat) => seat.playerId === room.you).displayName}'s turn`;

/**
 * Whose turn it is, announced to screen readers when it changes.
 *
 * @param {{ room: { you: string, status: string, seats: Array<{ playerId: string, displayName: string }>, game?: { activePlayers: string[] } } }} props
 */
export function TurnBanner({ room }) {
  const playing = room.status === "playing" && room.game !== undefined;
  // One showing for the whole game, counted as essential (CC-313).
  useInterruption("banner.turn", { open: playing });
  if (!playing) {
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
  return (
    <p
      className={`${styles.banner} ${yourTurn ? styles.yours : ""}`}
      aria-live="polite"
      data-cc-surface="banner.turn"
    >
      {text}
    </p>
  );
}
