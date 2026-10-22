import { useState } from "react";
import { getGame, ROOM_STATUS } from "@classicade/shared";
import { outcomeMoment } from "../../games/outcomeMoment.js";
import { incomingRequests, outgoingRequests } from "../../games/roomUpdates.js";
import { gameNumber, matchPhase, PLAY_REASONS } from "../../games/roomView.js";
import { useAction } from "../../hooks/useAction.js";
import { useMatchPhase } from "../../hooks/useMatchPhase.js";
import { ResultCelebration } from "../Celebrations/ResultCelebration.jsx";
import { ClaimWin } from "../ClaimWin/ClaimWin.jsx";
import { ComputerNote } from "../ComputerNote/ComputerNote.jsx";
import { RequestBanner } from "../RequestBanner/RequestBanner.jsx";
import { SaveProgressCard } from "../SaveProgress/SaveProgressCard.jsx";
import { Seats } from "../Seats/Seats.jsx";
import { ShareResult } from "../ShareResult/ShareResult.jsx";
import { ActionBar } from "./ActionBar.jsx";
import { MatchFrame, MatchStage } from "./MatchFrame.jsx";
import { sendIntent, shellLayout } from "./matchShell.js";
import styles from "./MatchShell.module.css";

/**
 * Whether the viewer saw the room's current game end on this page. A game that was already over when the page
 * opened (a reload, or a link to a finished room) is no new moment. A rematch that ends later is.
 */
function useSawItEnd(room) {
  const [opened] = useState(() => ({
    code: room.code,
    game: gameNumber(room),
    finished: room.status === ROOM_STATUS.FINISHED,
  }));
  return !(opened.finished && opened.code === room.code && opened.game === gameNumber(room));
}

/** Which requests stand for the viewer: one they were asked, one they asked, or none (CC-170). */
function requestState(room) {
  if (incomingRequests(room).length > 0) return "incoming";
  return outgoingRequests(room).length > 0 ? "outgoing" : "none";
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
 * 5. Result: the outcome moment at the end (CC-163): its stamp, the headline and the line under it, in the tone of
 *    how the game ended, with the action bar under it. After a loss the board's colours soften.
 * 6. Presence and panel, in the side column: who is in the room and the game's own `Panel`.
 * 7. Announcer: one polite and one urgent screen reader region. The result's headline and line are read out
 *    urgently.
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
  const moment = layout.result ? outcomeMoment(room) : undefined;
  const dimmed = moment?.effect === "dim";
  const sawItEnd = useSawItEnd(room);
  useMatchPhase(matchPhase(room), room.gameId);

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
    <MatchFrame
      pageTitle={`${gameName} · Room ${room.code}`}
      gameId={room.gameId}
      gameName={gameName}
      phase={matchPhase(room)}
      request={requestState(room)}
      banner={
        <>
          <RequestBanner room={room} onAction={act} onNewOpponent={bannerNewOpponent} reason={offline} />
          <ClaimWin room={room} onClaim={onClaimWin} reason={offline} />
        </>
      }
      score={score?.text}
      result={
        moment === undefined
          ? undefined
          : {
              moment,
              celebration: (
                <ResultCelebration key={room.game.matchId} room={room} moment={moment} live={sawItEnd} />
              ),
              footer: <ShareResult room={room} />,
            }
      }
      stage={
        <>
          {layout.stage === "waiting" ? (
            waiting
          ) : (
            <div
              className={dimmed ? `${styles.board} ${styles.dimmed}` : styles.board}
              data-cc-effect={dimmed ? "dim" : undefined}
            >
              <MatchStage room={room} game={game} onMove={onMove} onAsk={onAsk} reconnecting={reconnecting} />
            </div>
          )}
          {layout.result && <SaveProgressCard room={room} game={gameNumber(room)} />}
        </>
      }
      actionBar={actionBar}
      side={
        <>
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
        </>
      }
    />
  );
}
