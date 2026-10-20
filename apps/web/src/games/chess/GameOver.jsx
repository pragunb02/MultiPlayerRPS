import { useId } from "react";
import { buildPgn, endReasonText, pgnFileName, resultToken } from "./chessGame.js";
import styles from "./ChessBoard.module.css";

const SCORE_TEXT = Object.freeze({ "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½" });

/**
 * How the game ended (checkmate, resignation, time out and so on), the score, and the game as a PGN file. The
 * file is built here from the move list, so downloading it needs no request to the server.
 *
 * @param {{ room: any, names: Record<"w" | "b", string>, yourColour: "w" | "b" | "", site: string, children?: import("react").ReactNode }} props
 *   `names`: the players' display names by colour, `yourColour`: "" for a spectator. `children` go under the
 *   score: the rating changes today (CC-042), kept as a slot so the outcome screen (CC-163) can take them over
 */
export function GameOver({ room, names, yourColour, site, children }) {
  const titleId = useId();
  const { view, outcome } = room.game;
  const result = resultToken(outcome, view.colors);
  const winner = result === "1-0" ? "w" : "b";
  const winnerName = winner === yourColour ? "You" : names[winner];
  const summary =
    result === "1/2-1/2" ? "Draw" : `${winnerName} won with ${winner === "w" ? "White" : "Black"}`;
  const pgn = buildPgn({
    moves: view.moves,
    white: names.w,
    black: names.b,
    result,
    reason: outcome.reason,
    timeControl: view.timeControl,
    date: room.serverTime,
    site,
  });

  return (
    <section className={styles.gameOver} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.gameOverTitle}>
        {endReasonText(outcome.reason)}
      </h2>
      <p className={styles.gameOverResult}>
        <span>{summary}</span>
        <span className={styles.score}>{SCORE_TEXT[result]}</span>
      </p>
      {children}
      <a
        className={styles.download}
        data-cc-control="chess.pgn"
        href={`data:application/x-chess-pgn;charset=utf-8,${encodeURIComponent(pgn)}`}
        download={pgnFileName({ code: room.code, date: room.serverTime })}
      >
        Download PGN
      </a>
    </section>
  );
}
