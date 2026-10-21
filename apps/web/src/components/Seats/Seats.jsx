import { useState } from "react";
import { PRESENCE, ROOM_END_REASONS, ROOM_STATUS } from "@classicade/shared";
import { Avatar } from "../../art/avatars/Avatar.jsx";
import { usePresenceNotice } from "../../games/usePresenceNotice.js";
import { useAction } from "../../hooks/useAction.js";
import { useBlockPlayer } from "../../hooks/useBlocks.js";
import { useSession } from "../../hooks/useSession.js";
import { formatCountdown, useServerCountdown } from "../../hooks/useServerCountdown.js";
import { Button } from "../Button/Button.jsx";
import { isComputer, levelNameOf } from "../computer.js";
import { AddFriendButton } from "../Friends/AddFriendButton.jsx";
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
  room.you !== "" && seat.playerId !== room.you && !isComputer(seat) && seat.deleted !== true;

/**
 * Whether the viewer is offered Add friend for this seat (CC-052): an account, once the game is not on, for anyone
 * they could block. Not while a game is on, so a move is never one tap from a request, and the seat keeps its size
 * beside the board. A guest finds how to save their progress on the Friends page.
 */
const canAddFriend = (room, seat, identity) =>
  identity?.kind === "user" && room.status !== ROOM_STATUS.PLAYING && canBlock(room, seat);

/**
 * The question asked before a block, and the block itself (CC-044, ADR-053). The block is silent: the other player
 * is told nothing, and the toast is for the viewer only. It is drawn after the list of seats, not inside a seat: a
 * seat slides in with an animation, and a dialog inside it would be held to the seat's box instead of covering the
 * page.
 *
 * @param {{ room: { code: string }, seat: { playerId: string, displayName: string }, index: number, onClose: () => void, onBlocked: () => void }} props
 *   `index` is the seat's place in the room's seats. The server is told the place and who the page shows there, and
 *   blocks nobody if that seat holds someone else by the time the request arrives
 */
function BlockDialog({ room, seat, index, onClose, onBlocked }) {
  const blockPlayer = useBlockPlayer();
  const toast = useToast();
  const name = seat.displayName;
  const confirm = useAction(
    async () => {
      await blockPlayer({ roomCode: room.code, seat: index, seatId: seat.playerId });
      onClose();
      toast.show(`You blocked ${name}.`, { tone: "info" });
      onBlocked();
    },
    { id: "room.seat.block.confirm" },
  );
  return (
    <Modal
      open
      title={`Block ${name}?`}
      onClose={onClose}
      destructive
      actions={
        <>
          <Button control="room.seat.block.cancel" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            control="room.seat.block.confirm"
            variant="danger"
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
  );
}

/**
 * Who is in the room: avatars and names (CC-034), host, you, and where each player is (CC-158). A computer character is always
 * labelled as one, with its level (ADR-025). Changes to the other players are read
 * out once they settle, with a soft sound. A seated viewer can block another person from their seat (CC-044), and an
 * account can add them as a friend once the game is not on, which is the result screen (CC-052).
 *
 * @param {{ room: { code: string, seats: Array<{ playerId: string, displayName: string, avatar?: string, connected: boolean, presence: string, graceUntil: number, bot?: { character: string, level: string }, deleted?: true }>, hostId: string, you: string, players: { max: number }, status: string, serverTime: number, game?: object } }} props  every id in a room view is a seat id (CC-253)
 */
export function Seats({ room }) {
  const { identity } = useSession();
  const open = Math.max(0, room.players.max - room.seats.length);
  const notice = usePresenceNotice(room);
  // Blocked from this page. The server keeps the block. This only changes what the seat shows until the page goes.
  const [blocked, setBlocked] = useState(() => new Set());
  // The seat the viewer pressed Block on, and who sat where at that moment, while the question is open.
  const [asking, setAsking] = useState(undefined);
  const seating = room.seats.map((seat) => seat.playerId).join(" ");
  // The design contract's player colours (CC-314): a seated viewer sees their own seat as "you" and every other
  // seat as "opponent". A spectator has no seat, so the seats keep their own colours.
  const seated = room.seats.some((seat) => seat.playerId === room.you);
  const playerClass = (seat) => {
    if (!seated) return "";
    return seat.playerId === room.you ? styles.mine : styles.theirs;
  };
  // Someone left, joined or the seats swapped (a rematch) while the question was open. The question may now be about
  // someone else's seat, so it closes and the player can press Block again on the seat they mean.
  if (asking !== undefined && asking.seating !== seating) {
    setAsking(undefined);
  }
  return (
    <>
      <ul className={styles.seats} aria-label="Players">
        {room.seats.map((seat, index) => (
          <li key={seat.playerId} className={`${styles.seat} ${playerClass(seat)}`}>
            <span className={seat.connected ? styles.online : styles.offline} aria-hidden="true" />
            {!isComputer(seat) && <Avatar avatar={seat.avatar} size={28} />}
            <span className={styles.name}>{seat.displayName}</span>
            {seat.playerId === room.you && <span className={`${styles.tag} ${styles.tagYou}`}>you</span>}
            {isComputer(seat) && <span className={styles.tag}>computer · {levelNameOf(seat)}</span>}
            {seat.playerId === room.hostId && <span className={styles.tag}>host</span>}
            <PresenceChip room={room} seat={seat} />
            {blocked.has(seat.playerId) ? (
              <span className={styles.tag}>blocked</span>
            ) : (
              canBlock(room, seat) && (
                <>
                  {canAddFriend(room, seat, identity) && (
                    <AddFriendButton
                      target={{ roomCode: room.code, seat: index, seatId: seat.playerId }}
                      name={seat.displayName}
                      control="room.seat.friend"
                    />
                  )}
                  <Button
                    control="room.seat.block"
                    variant="ghost"
                    className={styles.block}
                    aria-label={`Block ${seat.displayName}`}
                    onClick={() => setAsking({ seat, index, seating })}
                  >
                    Block
                  </Button>
                </>
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
      {asking !== undefined && asking.seating === seating && (
        <BlockDialog
          room={room}
          seat={asking.seat}
          index={asking.index}
          onClose={() => setAsking(undefined)}
          onBlocked={() => setBlocked((current) => new Set([...current, asking.seat.playerId]))}
        />
      )}
      <p className="visually-hidden" role="status">
        {notice}
      </p>
    </>
  );
}
