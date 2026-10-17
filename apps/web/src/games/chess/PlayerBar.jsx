import { colourName, describePieces, opposite, pieceImage } from "./chessGame.js";
import { formatClock } from "./useChessClocks.js";
import styles from "./ChessBoard.module.css";

/** Under this much time left a clock turns red (the usual "low time" mark on chess sites). */
export const LOW_TIME_MS = 20_000;

/**
 * One player's strip beside the board: name, the pieces they have taken with their material lead, and their
 * clock. The clock glows while it runs and turns red under 20 seconds.
 *
 * @param {{ name: string, colour: "w" | "b", ms: number, running: boolean, live: boolean, captured: string[], advantage: number }} props
 *   `live`: the game is on, so a low clock matters
 */
export function PlayerBar({ name, colour, ms, running, live, captured, advantage }) {
  const low = live && ms < LOW_TIME_MS;
  const classes = [styles.clock, running && styles.running, low && styles.low].filter(Boolean);
  return (
    <div className={classes.join(" ")}>
      <div className={styles.who}>
        <span className={styles.name}>{name}</span>
        {captured.length > 0 && (
          <span className={styles.captured} role="img" aria-label={`Captured ${describePieces(captured)}`}>
            {captured.map((type, i) => (
              <img key={`${type}${i}`} src={pieceImage(opposite(colour), type)} alt="" />
            ))}
          </span>
        )}
        {advantage > 0 && (
          <span className={styles.advantage}>
            +{advantage}
            <span className="visually-hidden"> in material</span>
          </span>
        )}
      </div>
      {/* Marked as a ticker: it changes every second by itself, so it never counts as an answer to a press. */}
      <span className={styles.time} role="timer" aria-label={`${colourName(colour)} clock`} data-cc-ticker="">
        {formatClock(ms)}
      </span>
    </div>
  );
}
