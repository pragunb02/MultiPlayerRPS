import { isComputer, levelNameOf } from "../computer.js";
import styles from "./Seats.module.css";

/**
 * Who is in the room: names, host, you, and whether each player is connected. A computer character is always
 * labelled as one, with its level (ADR-025).
 *
 * @param {{ room: { seats: Array<{ playerId: string, displayName: string, connected: boolean, bot?: { character: string, level: string } }>, hostId: string, you: string, players: { max: number } } }} props
 */
export function Seats({ room }) {
  const open = Math.max(0, room.players.max - room.seats.length);
  return (
    <ul className={styles.seats} aria-label="Players">
      {room.seats.map((seat) => (
        <li key={seat.playerId} className={styles.seat}>
          <span className={seat.connected ? styles.online : styles.offline} aria-hidden="true" />
          <span>{seat.displayName}</span>
          {seat.playerId === room.you && <span className={styles.tag}>you</span>}
          {isComputer(seat) && <span className={styles.tag}>computer · {levelNameOf(seat)}</span>}
          {seat.playerId === room.hostId && <span className={styles.tag}>host</span>}
          {!seat.connected && <span className={styles.status}>disconnected</span>}
        </li>
      ))}
      {Array.from({ length: open }, (_, index) => (
        <li key={`open-${index}`} className={`${styles.seat} ${styles.empty}`}>
          Waiting for a player…
        </li>
      ))}
    </ul>
  );
}
