import { PRESENCE, ROOM_STATUS } from "@classicade/shared";
import { useAction } from "../../hooks/useAction.js";
import { useServerCountdown } from "../../hooks/useServerCountdown.js";
import { Button } from "../Button/Button.jsx";
import styles from "./ClaimWin.module.css";

const noop = () => undefined;

/** The first opponent who is offline in a game still on, or undefined. */
const goneOpponent = (room) =>
  room.status === ROOM_STATUS.PLAYING && room.you !== ""
    ? room.seats.find((seat) => seat.playerId !== room.you && seat.presence === PRESENCE.OFFLINE)
    : undefined;

/** The card for one opponent: nothing while their grace period runs, then the choice to claim the win. */
function GoneCard({ room, seat, onClaim, reason }) {
  const left = useServerCountdown({ until: seat.graceUntil, serverTime: room.serverTime, onElapsed: noop });
  const claim = useAction(onClaim, { id: "room.claim_win" });
  if (left > 0) {
    return null;
  }
  return (
    <section className={styles.card} aria-label="Opponent gone">
      <p role="status" className={styles.text}>
        {seat.displayName} has not come back. You can claim the win, or keep waiting.
      </p>
      <Button control="room.claim_win" action={claim} reason={reason}>
        Claim the win
      </Button>
    </section>
  );
}

/**
 * When the opponent lost their connection in a game still on and stayed away past the grace period (CC-036), the
 * player still there may claim the win. Until then the opponent's chip counts down how long they have to come
 * back. Waiting stays possible: the claim is the player's choice, never automatic.
 *
 * @param {{ room: any, onClaim: () => Promise<unknown>, reason?: string }} props  `room` is the RoomView.
 *   `reason`: why the claim cannot be sent now, such as "Reconnecting", empty when it can
 */
export function ClaimWin({ room, onClaim, reason = "" }) {
  const seat = goneOpponent(room);
  if (seat === undefined) {
    return null;
  }
  return (
    <GoneCard
      key={`${seat.playerId}:${seat.since}`}
      room={room}
      seat={seat}
      onClaim={onClaim}
      reason={reason}
    />
  );
}
