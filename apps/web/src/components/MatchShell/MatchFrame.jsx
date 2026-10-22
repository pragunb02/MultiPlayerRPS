import { Suspense, useState } from "react";
import { getGame } from "@classicade/shared";
import { GameIcon } from "../../art/games/GameIcon.jsx";
import { momentAnnouncement } from "../../games/outcomeMoment.js";
import { gameView } from "../../games/registry.js";
import { gameNumber, playReason } from "../../games/roomView.js";
import { FLAG_STATES } from "../../hooks/useFlag.js";
import { HowToPlayButton } from "../HowToPlay/HowToPlay.jsx";
import { PageTitle } from "../PageTitle.jsx";
import { MatchAnnouncer } from "./MatchAnnouncer.jsx";
import styles from "./MatchShell.module.css";

/**
 * The game's board, loaded on demand. A new game (a rematch, or Play again on one phone) is a fresh board, not the
 * last one's, because the board is keyed by the game's number.
 *
 * @param {{
 *   room: any,
 *   game: import("../../games/registry.js").GameViewEntry,
 *   onMove: (move: object) => Promise<unknown>,
 *   onAsk: (type: string) => Promise<unknown>,
 *   reconnecting: boolean,
 * }} props  `room` is the RoomView
 */
export function MatchStage({ room, game, onMove, onAsk, reconnecting }) {
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
 * The layout of a match, without knowing where the match comes from (CC-157, ADR-049). The room's `MatchShell` fills
 * it from the server, and pass and play fills it from a game running on the phone (CC-223), so both look and read
 * the same. Its slots, top to bottom:
 *
 * 1. Banner: whatever must sit above the match bar, such as the request banner.
 * 2. Match bar: the game's icon and name, a short score line when there is one, and How to play when it is on
 *    (CC-349). How to play opens a dialog over the page and never changes the board's place.
 * 3. Result: at the end, the outcome moment (CC-163): its celebration, the headline and the line under it, and a
 *    note, in the tone of how the game ended, with the action bar inside the card.
 * 4. Stage: the board, or whatever covers it.
 * 5. Action bar: under the stage while the game is on.
 * 6. Side column: the players, and the game's own panel.
 * 7. Announcer: the result's headline and line are read out urgently.
 *
 * @param {{
 *   pageTitle: string,
 *   gameId: string,
 *   gameName: string,
 *   phase: string,
 *   request?: string,
 *   banner?: import("react").ReactNode,
 *   score?: string,
 *   howToPlay?: { state: string, onOpen?: () => void },
 *   result?: {
 *     moment: Readonly<import("../../games/outcomeMoment.js").OutcomeMoment>,
 *     celebration?: import("react").ReactNode,
 *     note?: import("react").ReactNode,
 *     footer?: import("react").ReactNode,
 *   },
 *   stage: import("react").ReactNode,
 *   actionBar: import("react").ReactNode,
 *   side: import("react").ReactNode,
 * }} props  `phase` and `request` are written on the frame for tests and telemetry. `result` is given once the
 *   game is over, with the game's outcome moment (outcomeMoment), whose tone colours the card. Its `footer` goes
 *   under the action bar inside the card, such as the share buttons. `howToPlay` is the How to play button's flag
 *   state (FLAG_STATES) and its `onOpen`, told each time the player opens it. While the state is unknown the bar
 *   keeps the button's place, and once kept the place stays, so a late answer never moves the board (CC-349)
 */
export function MatchFrame({
  pageTitle,
  gameId,
  gameName,
  phase,
  request = "none",
  banner,
  score,
  howToPlay,
  result,
  stage,
  actionBar,
  side,
}) {
  const scoreLine = score !== undefined && <p className={styles.score}>{score}</p>;
  const helpState = howToPlay?.state ?? FLAG_STATES.OFF;
  const [keptPlace, setKeptPlace] = useState(false);
  const helpPlace =
    gameView(gameId).loadHowToPlay !== undefined && (helpState !== FLAG_STATES.OFF || keptPlace);
  if (helpPlace && !keptPlace) setKeptPlace(true);
  return (
    <MatchAnnouncer urgent={result ? momentAnnouncement(result.moment) : ""}>
      <section className={styles.shell} data-cc-phase={phase} data-cc-request={request}>
        <PageTitle>{pageTitle}</PageTitle>
        {banner}
        <header className={styles.matchBar} data-cc-slot="match-bar">
          <h1 className={styles.title}>
            <GameIcon gameId={gameId} size={32} />
            {gameName}
          </h1>
          {helpPlace ? (
            <div className={styles.barEnd}>
              {scoreLine}
              <div className={styles.barHelp} data-cc-slot="how-to-play-place">
                {helpState === FLAG_STATES.ON && (
                  <HowToPlayButton gameId={gameId} gameName={gameName} onOpen={howToPlay.onOpen} />
                )}
              </div>
            </div>
          ) : (
            scoreLine
          )}
        </header>

        <div className={styles.layout}>
          <div className={styles.main}>
            {result && (
              <section
                className={styles.outcome}
                aria-labelledby="result-heading"
                data-cc-slot="result"
                data-cc-tone={result.moment.tone}
              >
                <div className={styles.headline}>
                  {result.celebration}
                  <h2 id="result-heading">{result.moment.headline}</h2>
                  {/* Hinglish first and English under it, like every line of feeling (ADR-051). */}
                  <p className={styles.line} data-cc-outcome-line="">
                    <span>{result.moment.line.hinglish}</span>
                    <span>{result.moment.line.english}</span>
                  </p>
                  {result.note}
                </div>
                {actionBar}
                {result.footer}
              </section>
            )}
            <div className={styles.stage} data-cc-slot="stage">
              {stage}
            </div>
            {!result && actionBar}
          </div>
          <aside className={styles.side}>{side}</aside>
        </div>
      </section>
    </MatchAnnouncer>
  );
}
