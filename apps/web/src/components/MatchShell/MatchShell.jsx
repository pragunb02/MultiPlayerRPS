import { Suspense } from "react";
import { getGame } from "@classicade/shared";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { resultHeadline } from "../../games/outcomeText.js";
import { incomingRequests, outgoingRequests } from "../../games/roomUpdates.js";
import { gameNumber, matchPhase, playReason, PLAY_REASONS } from "../../games/roomView.js";
import { useAction } from "../../hooks/useAction.js";
import { outcomeFor } from "../Celebrations/outcome.js";
import { ResultCelebration } from "../Celebrations/ResultCelebration.jsx";
import { ClaimWin } from "../ClaimWin/ClaimWin.jsx";
import { ComputerNote } from "../ComputerNote/ComputerNote.jsx";
import { PageTitle } from "../PageTitle.jsx";
import { RequestBanner } from "../RequestBanner/RequestBanner.jsx";
import { SaveProgressCard } from "../SaveProgress/SaveProgressCard.jsx";
import { Seats } from "../Seats/Seats.jsx";
import { ShareResult } from "../ShareResult/ShareResult.jsx";
import { ActionBar } from "./ActionBar.jsx";
import { MatchAnnouncer } from "./MatchAnnouncer.jsx";
import { sendIntent, shellLayout } from "./matchShell.js";
import styles from "./MatchShell.module.css";

/** Which requests stand for the viewer: one they were asked, one they asked, or none (CC-170). */
function requestState(room) {
  if (incomingRequests(room).length > 0) return "incoming";
  return outgoingRequests(room).length > 0 ? "outgoing" : "none";
}

/** The game's board, loaded on demand. A rematch is a new game in this room: a fresh board, not the last one's. */
function Stage({ room, game, onMove, onAsk, reconnecting }) {
  const { Board } = game;
  if (Board === undefined) {
    return (
      <p className={styles.card}>The {getGame(room.gameId)?.name ?? "game"} board is not available yet.</p>
    );
  }
  return (
    <Suspense fallback={<p aria-busy="true">Loading the board…</p>}>
      <Board
        key={gameNumber(room)}
        room={room}
        onMove={onMove}
        onAsk={onAsk}
        reason={playReason(room, { reconnecting })}
      />
    </Suspense>
  );
}

/**
 * One frame for every game's match (CC-157, ADR-049). The room page hands it the room and the game's registry
 * entry, and it never names a game. Its slots, top to bottom:
 *
 * 1. Banner: the request banner, sticky at the top while the page scrolls, and the choice to claim the win when the
 *    opponent has gone. The player's own connection shows in the site's banner just above it.
 * 2. Match bar: the game's name and, when the game has one, the score inside the game (`inGameScore`).
 * 3. Stage: the game's `Board`, or the invite while the room waits for players.
 * 4. Action bar: the game's `actions` and Leave, under the board. At the end it moves into the result.
 * 5. Result: the headline and its celebration at the end, with the action bar under it and the result share at the
 *    bottom (CC-217).
 * 6. Presence and panel, in the side column: who is in the room and the game's own `Panel`.
 * 7. Announcer: one polite and one urgent screen reader region. The result is read out urgently.
 *
 * Every slot gets the room as the server sent it, and buttons only send intents. Nothing here decides a result.
 *
 * @param {{
 *   room: any,
 *   game: import("../../games/registry.js").GameViewEntry,
 *   reconnecting: boolean,
 *   waiting: import("react").ReactNode,
 *   onMove: (move: object) => Promise<unknown>,
 *   onAsk: (type: string) => Promise<unknown>,
 *   onAnswer: (type: string, answer: string) => Promise<unknown>,
 *   onClaimWin: () => Promise<unknown>,
 *   onWindowEnded: () => void,
 *   onLeave: () => Promise<unknown>,
 * }} props  `room` is the RoomView. `reconnecting`: whether the connection is being restored. `waiting`: what the
 *   stage shows while the room waits for players. `onLeave` gives the seat up and opens the game's lobby
 */
export function MatchShell({
  room,
  game,
  reconnecting,
  waiting,
  onMove,
  onAsk,
  onAnswer,
  onClaimWin,
  onWindowEnded,
  onLeave,
}) {
  // The same choice as New opponent, in the request banner when the opponent cannot answer (CC-207).
  const bannerNewOpponent = useAction(onLeave, { id: "request.new_opponent" });
  const layout = shellLayout(room);
  const catalogName = getGame(room.gameId)?.name;
  const gameName = catalogName ?? room.gameId;
  const offline = reconnecting ? PLAY_REASONS.RECONNECTING : "";
  const score = layout.stage === "waiting" ? undefined : game.inGameScore?.(room);
  const { Panel } = game;

  /** What a request button does (RoomAction): a game move, asking for something, or answering a request. */
  function act(action) {
    return action.type === "answer"
      ? onAnswer(action.requestType, action.answer)
      : sendIntent(action, { onMove, onAsk });
  }

  const actionBar = (
    <ActionBar
      room={room}
      game={game}
      playLabel={`Play ${catalogName ?? "a game"}`}
      offline={offline}
      onMove={onMove}
      onAsk={onAsk}
      onRoomAction={act}
      onWindowEnded={onWindowEnded}
      onLeave={onLeave}
      placement={layout.actionBar}
    />
  );

  return (
    <MatchAnnouncer urgent={layout.result ? resultHeadline(room) : ""}>
      <section className={styles.shell} data-cc-phase={matchPhase(room)} data-cc-request={requestState(room)}>
        <PageTitle>{`${gameName} · Room ${room.code}`}</PageTitle>
        <RequestBanner room={room} onAction={act} onNewOpponent={bannerNewOpponent} reason={offline} />
        <ClaimWin room={room} onClaim={onClaimWin} reason={offline} />
        <header className={styles.matchBar} data-cc-slot="match-bar">
          <h1 className={styles.title}>
            <GameIcon gameId={room.gameId} size={32} />
            {gameName}
          </h1>
          {score !== undefined && <p className={styles.score}>{score.text}</p>}
        </header>

        <div className={styles.layout}>
          <div className={styles.main}>
            {layout.result && (
              <section
                className={`${styles.outcome} ${styles[outcomeFor(room)]}`}
                aria-labelledby="result-heading"
                data-cc-slot="result"
              >
                <div className={styles.headline}>
                  <ResultCelebration room={room} />
                  <h2 id="result-heading">{resultHeadline(room)}</h2>
                </div>
                {actionBar}
                <ShareResult room={room} />
              </section>
            )}
            <div className={styles.stage} data-cc-slot="stage">
              {layout.stage === "waiting" ? (
                waiting
              ) : (
                <Stage room={room} game={game} onMove={onMove} onAsk={onAsk} reconnecting={reconnecting} />
              )}
              {layout.result && <SaveProgressCard room={room} game={gameNumber(room)} />}
            </div>
            {layout.actionBar === "under-stage" && actionBar}
          </div>
          <aside className={styles.side}>
            <div className={styles.presence} data-cc-slot="presence">
              <h2 className="visually-hidden">Players</h2>
              <Seats room={room} />
              <ComputerNote room={room} />
            </div>
            {Panel !== undefined && layout.stage === "board" && (
              <div data-cc-slot="panel">
                <Panel room={room} />
              </div>
            )}
          </aside>
        </div>
      </section>
    </MatchAnnouncer>
  );
}
