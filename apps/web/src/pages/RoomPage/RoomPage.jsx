import { Suspense, useCallback, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import { ERROR_CODES, getGame, ROOM_CLOSE_REASONS, ROOM_STATUS } from "@classicade/shared";
import { gameForSlug, normaliseRoomCode, paths } from "../../app/paths.js";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { InviteArt } from "../../art/illustrations/InviteArt.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { outcomeFor } from "../../components/Celebrations/outcome.js";
import { ResultCelebration } from "../../components/Celebrations/ResultCelebration.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { RematchPanel } from "../../components/Rematch/RematchPanel.jsx";
import { SaveProgressCard } from "../../components/SaveProgress/SaveProgressCard.jsx";
import { Seats } from "../../components/Seats/Seats.jsx";
import { ShareRoom } from "../../components/ShareRoom/ShareRoom.jsx";
import { useToast } from "../../components/Toast/toastContext.js";
import { resultHeadline } from "../../games/outcomeText.js";
import { gameView } from "../../games/registry.js";
import { incomingRequests, roomRequests } from "../../games/roomUpdates.js";
import { gameNumber, matchPhase, playReason, PLAY_REASONS } from "../../games/roomView.js";
import { useRoomAlerts } from "../../games/useRoomAlerts.js";
import { useAction } from "../../hooks/useAction.js";
import { useReconnecting } from "../../hooks/useReconnecting.js";
import { useRoom } from "../../hooks/useRoom.js";
import { useSession } from "../../hooks/useSession.js";
import { JoinChooser } from "./JoinChooser.jsx";
import { RoomRequests } from "./RoomRequests.jsx";
import styles from "./RoomPage.module.css";

/** Why a room closed, in the players' words (CC-101). */
const CLOSED_REASONS = Object.freeze({
  [ROOM_CLOSE_REASONS.EXPIRED]: "Nobody joined in time, so the room closed.",
  [ROOM_CLOSE_REASONS.EMPTY]: "Everyone left, so the room closed.",
  [ROOM_CLOSE_REASONS.ABANDONED]: "Everyone was away from the game for too long, so the room closed.",
  [ROOM_CLOSE_REASONS.REMATCH_WINDOW_ENDED]: "The time for a rematch is over, so the room closed.",
});

/**
 * A room that is gone for good: why, and the quickest way to a new game of the same kind.
 *
 * @param {{ reason: string, game: { id: string, name: string } | undefined }} props
 */
function RoomClosed({ reason, game }) {
  return (
    <section>
      <PageTitle>Room closed</PageTitle>
      <h1>Room closed</h1>
      <p>{CLOSED_REASONS[reason] ?? "This room has been closed."}</p>
      {game && (
        <p>
          <Link to={paths.game(game.id)} data-cc-control="room.closed.new_game">
            Start a new {game.name} game
          </Link>
        </p>
      )}
      <Link to={paths.home()} data-cc-control="room.closed.home">
        Back to the games
      </Link>
    </section>
  );
}

/** Which requests stand for the viewer: one they were asked, one they asked, or none (CC-170). */
function requestState(room) {
  if (incomingRequests(room).length > 0) return "incoming";
  return roomRequests(room).some((request) => request.from === room.you) ? "outgoing" : "none";
}

/**
 * A room from joining to the result: waiting with an invite, the game board, the outcome. Its URL names the game
 * and the room; any other spelling (lower-case code, old `/room/:code` link, wrong game) is replaced by the
 * canonical one — before joining where the code alone decides it, after joining where the room's game does.
 *
 * Someone who arrives without a session first chooses how to join: as a guest, or by logging in or signing up
 * and coming straight back (CC-086). Nothing is created for them until they choose.
 */
export function RoomPage() {
  const params = useParams();
  const code = normaliseRoomCode(params.code);
  const urlGame = gameForSlug(params.slug);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const session = useSession();
  const room = useRoom(code, { enabled: session.status === "ready" });
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const reconnecting = useReconnecting();
  const gameId = room.room?.gameId ?? urlGame?.id;
  const notify = useCallback((message) => toast.show(message, { tone: "info" }), [toast]);
  useRoomAlerts(room.room, { notify, dismiss: toast.dismiss });

  /**
   * Leaves the seat and opens the game's lobby. In a game still on this forfeits it. After a finished game it takes
   * back any rematch request and tells the opponent, so nobody waits for a player who is gone (CC-162). Replace,
   * not push: Back must not lead into the room you just left and seat you in it again.
   */
  const leaveRoom = async () => {
    await room.leave();
    navigate(paths.game(gameId), { replace: true });
  };
  const leave = useAction(leaveRoom, { id: "room.leave" });
  const forfeit = useAction(leaveRoom, { id: "room.leave.confirm" });
  const newOpponent = useAction(leaveRoom, { id: "room.new_opponent" });

  if (gameId !== undefined && location.pathname !== paths.room(gameId, code)) {
    return <Navigate to={paths.room(gameId, code)} replace />;
  }
  if (session.status === "anonymous") {
    return (
      <JoinChooser
        code={code}
        game={urlGame}
        returnTo={location.pathname}
        onPlayAsGuest={session.ensurePlayer}
      />
    );
  }
  if (session.status === "error") {
    return (
      <section>
        <PageTitle>Can't join this room</PageTitle>
        <h1>Can't join this room</h1>
        <p>{session.error.message}</p>
        <Link to={paths.home()} data-cc-control="room.error.home">
          Back to the games
        </Link>
      </section>
    );
  }
  if (session.status === "loading" || room.status === "joining") {
    return (
      <>
        <PageTitle>{`Room ${code}`}</PageTitle>
        <p aria-busy="true">Joining room {code}…</p>
      </>
    );
  }
  if (room.status === "error" && room.error.code === ERROR_CODES.GONE) {
    return (
      <RoomClosed reason={room.error.details.reason} game={getGame(room.error.details.gameId) ?? urlGame} />
    );
  }
  if (room.status === "error") {
    const notFound =
      room.error.code === ERROR_CODES.NOT_FOUND || room.error.code === ERROR_CODES.VALIDATION_FAILED;
    return (
      <section>
        <PageTitle>{notFound ? "Room not found" : "Can't join this room"}</PageTitle>
        <h1>{notFound ? "Room not found" : "Can't join this room"}</h1>
        <p>{notFound ? `There is no room with the code ${code}.` : room.error.message}</p>
        {urlGame && (
          <p>
            <Link to={paths.game(urlGame.id)} data-cc-control="room.error.new_game">
              Start a new {urlGame.name} game
            </Link>
          </p>
        )}
        <Link to={paths.home()} data-cc-control="room.error.home">
          Back to the games
        </Link>
      </section>
    );
  }
  if (room.status === "closed") {
    return <RoomClosed reason={room.closedReason} game={getGame(room.room?.gameId) ?? urlGame} />;
  }

  const view = room.room;
  const game = getGame(view.gameId);
  const { Board } = gameView(view.gameId);
  const playing = view.status === ROOM_STATUS.PLAYING;
  const finished = view.status === ROOM_STATUS.FINISHED;
  const offline = reconnecting ? PLAY_REASONS.RECONNECTING : "";

  /** What a request button does (RoomAction): a game move, or asking for or declining a rematch. */
  function act(action) {
    if (action.type === "move") return room.move(action.move);
    return action.type === "rematch" ? room.rematch() : room.declineRematch();
  }

  return (
    <section className={styles.room} data-cc-phase={matchPhase(view)} data-cc-request={requestState(view)}>
      <PageTitle>{`${game?.name ?? view.gameId} · Room ${view.code}`}</PageTitle>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <GameIcon gameId={view.gameId} size={32} />
          {game?.name ?? view.gameId}
        </h1>
        <Button
          control="room.leave"
          variant="ghost"
          action={leave}
          reason={offline}
          onClick={() => (playing ? setConfirmingLeave(true) : leave.run())}
        >
          Leave room
        </Button>
      </header>

      <div className={styles.layout}>
        <div className={styles.stage}>
          <RoomRequests room={view} onAction={act} reason={offline} />
          {finished && (
            <section
              className={`${styles.outcome} ${styles[outcomeFor(view)]}`}
              aria-labelledby="result-heading"
            >
              <div className={styles.headline} role="status">
                <ResultCelebration room={view} />
                <h2 id="result-heading">{resultHeadline(view)}</h2>
              </div>
              <RematchPanel
                room={view}
                onRematch={room.rematch}
                onWindowEnded={room.refresh}
                reason={offline}
              />
              {view.you === "" ? (
                <Link to={paths.game(view.gameId)} className={styles.again} data-cc-control="room.play_game">
                  Play {game?.name ?? "a game"}
                </Link>
              ) : (
                <Button control="room.new_opponent" variant="secondary" action={newOpponent} reason={offline}>
                  New opponent
                </Button>
              )}
            </section>
          )}
          {view.status === ROOM_STATUS.WAITING && (
            <div className={`${styles.card} ${styles.invite}`}>
              <InviteArt className={styles.inviteArt} />
              <h2>Invite a friend</h2>
              <ShareRoom code={view.code} gameId={view.gameId} />
            </div>
          )}
          {view.status !== ROOM_STATUS.WAITING &&
            (Board ? (
              <Suspense fallback={<p aria-busy="true">Loading the board…</p>}>
                {/* A rematch is a new game in this room: a fresh board, not the last game's leftovers. */}
                <Board
                  key={gameNumber(view)}
                  room={view}
                  onMove={room.move}
                  reason={playReason(view, { reconnecting })}
                />
              </Suspense>
            ) : (
              <p className={styles.card}>The {game?.name ?? "game"} board is not available yet.</p>
            ))}
          {finished && <SaveProgressCard room={view} game={gameNumber(view)} />}
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
            <Button control="room.leave.stay" variant="secondary" onClick={() => setConfirmingLeave(false)}>
              Stay
            </Button>
            <Button control="room.leave.confirm" action={forfeit} reason={offline}>
              Leave and forfeit
            </Button>
          </>
        }
      >
        <p>The game is still on. If you leave now, you forfeit and your opponent wins.</p>
      </Modal>
    </section>
  );
}
