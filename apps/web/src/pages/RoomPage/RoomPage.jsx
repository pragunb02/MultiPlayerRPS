import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ERROR_CODES, getGame, ROOM_STATUS } from "@classicade/shared";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { Seats } from "../../components/Seats/Seats.jsx";
import { ShareRoom } from "../../components/ShareRoom/ShareRoom.jsx";
import { useToast } from "../../components/Toast/toastContext.js";
import { gameView } from "../../games/registry.js";
import { useRoom } from "../../hooks/useRoom.js";
import styles from "./RoomPage.module.css";

const CLOSED_REASONS = Object.freeze({
  expired: "This room expired after being idle.",
  abandoned: "Everyone left, so the room was closed.",
  empty: "The room is empty and has been closed.",
});

/** How the finished game went, from the viewer's point of view. */
function outcomeText(room) {
  const { outcome } = room.game;
  if (outcome.result === "draw") {
    return "It's a draw";
  }
  if (room.you === "") {
    const winner = room.seats.find((seat) => seat.playerId === outcome.winners[0]);
    return `${winner?.displayName ?? "Someone"} won`;
  }
  return outcome.winners.includes(room.you) ? "You won!" : "You lost";
}

/** A room from joining to the result: waiting with an invite, the game board, the outcome. */
export function RoomPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const room = useRoom(code);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  if (room.status === "joining") {
    return <p aria-busy="true">Joining room {code}…</p>;
  }
  if (room.status === "error") {
    const notFound =
      room.error.code === ERROR_CODES.NOT_FOUND || room.error.code === ERROR_CODES.VALIDATION_FAILED;
    return (
      <section>
        <h1>{notFound ? "Room not found" : "Can't join this room"}</h1>
        <p>{notFound ? `There is no room with the code ${code}.` : room.error.message}</p>
        <Link to="/">Back to the games</Link>
      </section>
    );
  }
  if (room.status === "closed") {
    return (
      <section>
        <h1>Room closed</h1>
        <p>{CLOSED_REASONS[room.closedReason] ?? "This room has been closed."}</p>
        <Link to="/">Back to the games</Link>
      </section>
    );
  }

  const view = room.room;
  const game = getGame(view.gameId);
  const { Board } = gameView(view.gameId);
  const playing = view.status === ROOM_STATUS.PLAYING;

  async function leave() {
    setConfirmingLeave(false);
    try {
      await room.leave();
      navigate(`/play/${view.gameId}`);
    } catch (error) {
      toast.show(error.message, { tone: "danger" });
    }
  }

  return (
    <section className={styles.room}>
      <header className={styles.header}>
        <h1>{game?.name ?? view.gameId}</h1>
        <Button variant="ghost" onClick={() => (playing ? setConfirmingLeave(true) : leave())}>
          Leave room
        </Button>
      </header>

      <div className={styles.layout}>
        <div className={styles.stage}>
          {view.status === ROOM_STATUS.WAITING && (
            <div className={styles.card}>
              <h2>Invite a friend</h2>
              <ShareRoom code={view.code} gameId={view.gameId} />
            </div>
          )}
          {view.status !== ROOM_STATUS.WAITING &&
            (Board ? (
              <Board room={view} onMove={room.move} />
            ) : (
              <p className={styles.card}>The {game?.name ?? "game"} board is not available yet.</p>
            ))}
          {view.status === ROOM_STATUS.FINISHED && (
            <div className={styles.outcome} role="status">
              <h2>{outcomeText(view)}</h2>
              <Link to={`/play/${view.gameId}`}>Play again</Link>
            </div>
          )}
        </div>
        <aside className={styles.side}>
          <h2 className="visually-hidden">Players</h2>
          <Seats room={view} />
        </aside>
      </div>

      <Modal
        open={confirmingLeave}
        title="Leave the game?"
        onClose={() => setConfirmingLeave(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmingLeave(false)}>
              Stay
            </Button>
            <Button onClick={leave}>Leave and forfeit</Button>
          </>
        }
      >
        <p>The game is still on. If you leave now, you forfeit and your opponent wins.</p>
      </Modal>
    </section>
  );
}
