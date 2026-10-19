import { useState } from "react";
import { PRESENCE, ROOM_END_REASONS, ROOM_STATUS } from "@classicade/shared";
import { usePresenceNotice } from "../../games/usePresenceNotice.js";
import { useAction } from "../../hooks/useAction.js";
import { useBlockPlayer } from "../../hooks/useBlocks.js";
import { formatCountdown, useServerCountdown } from "../../hooks/useServerCountdown.js";
import { Button } from "../Button/Button.jsx";
import { isComputer, levelNameOf } from "../computer.js";
import { Modal } from "../Modal/Modal.jsx";
import { useToast } from "../Toast/toastContext.js";
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
 * Whether the viewer can block the player in this seat (CC-044): only from their own seat, and only another person,
 * never a computer character or a deleted player's stand-in.
 */
const canBlock = (room, seat) =>
  room.you !== "" && seat.playerId !== room.you && !isComputer(seat) && !seat.playerId.startsWith("deleted_");

/**
 * The Block button of one seat and the question it asks first (CC-044, ADR-053). The block is silent: the other
 * player is told nothing, and the toast is for the viewer only.
 *
 * @param {{ room: { code: string }, seat: { displayName: string }, index: number, onBlocked: () => void }} props
 *   `index` is the seat's place in the room's seats, which is how the server is told who to block
 */
function BlockSeat({ room, seat, index, onBlocked }) {
  const blockPlayer = useBlockPlayer();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const name = seat.displayName;
  const confirm = useAction(
    async () => {
      await blockPlayer({ roomCode: room.code, seat: index });
      setAsking(false);
      toast.show(`You blocked ${name}.`, { tone: "info" });
      onBlocked();
    },
    { id: "room.seat.block.confirm" },
  );
  return (
    <>
      <Button
        control="room.seat.block"
        variant="ghost"
        className={styles.block}
        aria-label={`Block ${name}`}
        onClick={() => setAsking(true)}
      >
        Block
      </Button>
      <Modal
        open={asking}
        title={`Block ${name}?`}
        onClose={() => setAsking(false)}
        actions={
          <>
            <Button control="room.seat.block.cancel" variant="secondary" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              control="room.seat.block.confirm"
              variant="accent"
              action={confirm}
              pendingLabel="Blocking…"
            >
              Block
            </Button>
          </>
        }
      >
        <p>
          You won&apos;t be put in a room with {name} again, and there are no rematches between you. {name} is
          not told. You can unblock them on your profile.
        </p>
      </Modal>
    </>
  );
}

/**
 * Who is in the room: names, host, you, and where each player is (CC-158). A computer character is always
 * labelled as one, with its level (ADR-025). Changes to the other players are read
 * out once they settle, with a soft sound. A seated viewer can block another person from their seat (CC-044).
 *
 * @param {{ room: { code: string, seats: Array<{ playerId: string, displayName: string, connected: boolean, presence: string, graceUntil: number, bot?: { character: string, level: string } }>, hostId: string, you: string, players: { max: number }, status: string, serverTime: number, game?: object } }} props
 */
export function Seats({ room }) {
  const open = Math.max(0, room.players.max - room.seats.length);
  const notice = usePresenceNotice(room);
  // Blocked from this page. The server keeps the block. This only changes what the seat shows until the page goes.
  const [blocked, setBlocked] = useState(() => new Set());
  return (
    <>
      <ul className={styles.seats} aria-label="Players">
        {room.seats.map((seat, index) => (
          <li key={seat.playerId} className={styles.seat}>
            <span className={seat.connected ? styles.online : styles.offline} aria-hidden="true" />
            <span className={styles.name}>{seat.displayName}</span>
            {seat.playerId === room.you && <span className={styles.tag}>you</span>}
            {isComputer(seat) && <span className={styles.tag}>computer · {levelNameOf(seat)}</span>}
            {seat.playerId === room.hostId && <span className={styles.tag}>host</span>}
            <PresenceChip room={room} seat={seat} />
            {blocked.has(seat.playerId) ? (
              <span className={styles.tag}>blocked</span>
            ) : (
              canBlock(room, seat) && (
                <BlockSeat
                  room={room}
                  seat={seat}
                  index={index}
                  onBlocked={() => setBlocked((current) => new Set([...current, seat.playerId]))}
                />
              )
            )}
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
