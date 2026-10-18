import { PRESENCE, ROOM_END_REASONS, ROOM_STATUS } from "@classicade/shared";
import { usePresenceNotice } from "../../games/usePresenceNotice.js";
import { formatCountdown, useServerCountdown } from "../../hooks/useServerCountdown.js";
import { isComputer, levelNameOf } from "../computer.js";
import styles from "./Seats.module.css";

const noop = () => undefined;

/** Minutes and seconds left, shown beside a status. */
const Timer = ({ left }) => (
  <span className={styles.timer} data-cc-ticker="">
    {formatCountdown(left)}
  </span>
);

/** Whether the seat's player lost a finished game by leaving it, or by staying disconnected (CC-036). */
const leftTheGame = (room, seat) =>
  room.status === ROOM_STATUS.FINISHED &&
  room.game?.outcome.reason === ROOM_END_REASONS.FORFEIT &&
  !room.game.outcome.winners.includes(seat.playerId);

/**
 * Where one player is, as a chip (CC-158): connected, thinking with the time left to move, away from the game
 * screen, reconnecting with the time left to come back, offline, or left. The timers change every second by
 * themselves, so they are tickers.
 */
function PresenceChip({ room, seat }) {
  const graceLeft = useServerCountdown({
    until: seat.graceUntil,
    serverTime: room.serverTime,
    onElapsed: noop,
  });
  const turnLeft = useServerCountdown({
    until: room.game?.turnEndsAt ?? 0,
    serverTime: room.serverTime,
    onElapsed: noop,
  });
  if (leftTheGame(room, seat)) {
    return <span className={`${styles.status} ${styles.gone}`}>left</span>;
  }
  if (seat.presence === PRESENCE.AWAY) {
    return <span className={`${styles.status} ${styles.away}`}>away from the game screen</span>;
  }
  if (seat.presence === PRESENCE.OFFLINE) {
    return (
      <span className={`${styles.status} ${styles.away}`}>
        {graceLeft > 0 ? (
          <>
            reconnecting <Timer left={graceLeft} />
          </>
        ) : (
          "offline"
        )}
      </span>
    );
  }
  const thinking = room.status === ROOM_STATUS.PLAYING && room.game.activePlayers.includes(seat.playerId);
  if (!thinking) {
    return <span className={styles.status}>connected</span>;
  }
  return <span className={styles.status}>thinking {turnLeft > 0 && <Timer left={turnLeft} />}</span>;
}

/**
 * Who is in the room: names, host, you, and where each player is (CC-158). A computer character is always
 * labelled as one, with its level (ADR-025). Changes to the other players are read
 * out once they settle, with a soft sound.
 *
 * @param {{ room: { seats: Array<{ playerId: string, displayName: string, connected: boolean, presence: string, graceUntil: number, bot?: { character: string, level: string } }>, hostId: string, you: string, players: { max: number }, status: string, serverTime: number, game?: object } }} props
 */
export function Seats({ room }) {
  const open = Math.max(0, room.players.max - room.seats.length);
  const notice = usePresenceNotice(room);
  return (
    <>
      <ul className={styles.seats} aria-label="Players">
        {room.seats.map((seat) => (
          <li key={seat.playerId} className={styles.seat}>
            <span className={seat.connected ? styles.online : styles.offline} aria-hidden="true" />
            <span className={styles.name}>{seat.displayName}</span>
            {seat.playerId === room.you && <span className={styles.tag}>you</span>}
            {isComputer(seat) && <span className={styles.tag}>computer · {levelNameOf(seat)}</span>}
            {seat.playerId === room.hostId && <span className={styles.tag}>host</span>}
            <PresenceChip room={room} seat={seat} />
          </li>
        ))}
        {Array.from({ length: open }, (_, index) => (
          <li key={`open-${index}`} className={`${styles.seat} ${styles.empty}`}>
            Waiting for a player…
          </li>
        ))}
      </ul>
      <p className="visually-hidden" role="status">
        {notice}
      </p>
    </>
  );
}
