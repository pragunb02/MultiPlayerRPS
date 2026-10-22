import { useCallback } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { ERROR_CODES, getGame, ROOM_CLOSE_REASONS, ROOM_STATUS } from "@classicade/shared";
import { gameForSlug, normaliseRoomCode, paths } from "../../app/paths.js";
import { InviteArt } from "../../art/illustrations/InviteArt.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { Card, CardHeader, CardMedia } from "../../components/Card/Card.jsx";
import { MatchShell } from "../../components/MatchShell/MatchShell.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { ShareRoom } from "../../components/ShareRoom/ShareRoom.jsx";
import { EmptyState, Skeleton } from "../../components/States/States.jsx";
import { useMarkInGame } from "../../components/SiteRequests/inGameContext.js";
import { useToast } from "../../components/Toast/toastContext.js";
import { gameView } from "../../games/registry.js";
import { useRoomAlerts } from "../../games/useRoomAlerts.js";
import { useReconnecting } from "../../hooks/useReconnecting.js";
import { useRoom } from "../../hooks/useRoom.js";
import { useSession } from "../../hooks/useSession.js";
import { CATEGORIES } from "../../lib/notify/categories.js";
import { JoinChooser } from "./JoinChooser.jsx";
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
      <DeadEnd
        title="Room closed"
        line={CLOSED_REASONS[reason] ?? "This room has been closed."}
        game={game}
        controls="room.closed"
      />
    </section>
  );
}

/**
 * A room the player cannot get into: the shared empty state as the page's title, why in one line, then the one way
 * on (a new game of the same kind, when the game is known) and a quieter way back to the games (CC-323).
 *
 * @param {{ title: string, line: string, game: { id: string, name: string } | undefined, controls: string }} props
 *   `controls`: the start of the two links' control names
 */
function DeadEnd({ title, line, game, controls }) {
  return (
    <EmptyState
      title={title}
      headingLevel={1}
      action={
        game && (
          <Button as="link" to={paths.game(game.id)} control={`${controls}.new_game`}>
            Start a new {game.name} game
          </Button>
        )
      }
      secondary={
        <Button as="link" to={paths.home()} control={`${controls}.home`} variant={game ? "ghost" : "primary"}>
          Back to the games
        </Button>
      }
    >
      {line}
    </EmptyState>
  );
}

/**
 * Who the game waits for when every seat is taken but someone is away, by name, or "" when nobody is (CC-112). The
 * server starts the game only when everyone is there.
 */
function awayFromFullRoom(room) {
  if (room.seats.length < room.players.max) return "";
  return room.seats
    .filter((seat) => !seat.connected)
    .map((seat) => seat.displayName)
    .join(" and ");
}

/**
 * A room from joining to the result. The page joins the room and handles a room that is closed, missing or
 * refused. An open room is drawn by the match shell (CC-157), with the invite on its stage while the room waits for
 * players.
 *
 * Its URL names the game and the room. Any other spelling (a lower-case code, an old `/room/:code` link, the wrong
 * game) is replaced by the canonical one: before joining where the code alone decides it, after joining where the
 * room's game does.
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
  const reconnecting = useReconnecting();
  const gameId = room.room?.gameId ?? urlGame?.id;
  const notify = useCallback(
    (message) => toast.show(message, { tone: "info", category: CATEGORIES.SOCIAL }),
    [toast],
  );
  useRoomAlerts(room.room, { notify, dismiss: toast.dismiss });
  // A player in a game here is never interrupted by a request from elsewhere: it waits for the end (CC-207).
  useMarkInGame(room.room?.status === ROOM_STATUS.PLAYING && room.room.you !== "");

  /**
   * Leaves the seat and opens the game's lobby. In a game still on this forfeits it. After a finished game it takes
   * back any rematch request and tells the opponent, so nobody waits for a player who is gone (CC-162). Replace,
   * not push: Back must not lead into the room you just left and seat you in it again.
   */
  const leaveRoom = async () => {
    await room.leave();
    navigate(paths.game(gameId), { replace: true });
  };

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
        <DeadEnd title="Can't join this room" line={session.error.message} controls="room.error" />
      </section>
    );
  }
  if (session.status === "loading" || room.status === "joining") {
    return (
      <>
        <PageTitle>{`Room ${code}`}</PageTitle>
        <Skeleton label={`Joining room ${code}…`} shape="block" />
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
        <DeadEnd
          title={notFound ? "Room not found" : "Can't join this room"}
          line={notFound ? `There is no room with the code ${code}.` : room.error.message}
          game={urlGame}
          controls="room.error"
        />
      </section>
    );
  }
  if (room.status === "closed") {
    return <RoomClosed reason={room.closedReason} game={getGame(room.room?.gameId) ?? urlGame} />;
  }

  const view = room.room;
  const away = awayFromFullRoom(view);
  const waiting =
    away === "" ? (
      <Card as="div" variant="raised">
        <CardMedia className={styles.inviteMedia}>
          <InviteArt className={styles.inviteArt} />
        </CardMedia>
        <CardHeader title="Invite a friend" titleAs="h2" />
        <ShareRoom code={view.code} gameId={view.gameId} />
      </Card>
    ) : (
      <Card as="div" role="status">
        <CardHeader
          title={`Waiting for ${away}`}
          titleAs="h2"
          description={`${away} is away. The game starts as soon as they are back.`}
        />
      </Card>
    );

  return (
    <MatchShell
      room={view}
      game={gameView(view.gameId)}
      reconnecting={reconnecting}
      waiting={waiting}
      onMove={room.move}
      onAsk={room.ask}
      onAnswer={room.answer}
      onClaimWin={room.claimWin}
      onWindowEnded={room.refresh}
      onLeave={leaveRoom}
    />
  );
}
