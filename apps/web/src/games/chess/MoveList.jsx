import { useEffect, useRef } from "react";
import styles from "./ChessBoard.module.css";

/**
 * The moves in chess notation (like e4 or Nf3), two per numbered row, and buttons to look back through the
 * game. Looking back only changes what this player sees. The game goes on, and "Latest move" returns to it.
 *
 * @param {{ moves: ReadonlyArray<string>, ply: number, latest: number, onGoTo: (ply: number) => void }} props
 *   `ply`: the position on show (0 is the start), `latest`: the newest position
 */
export function MoveList({ moves, ply, latest, onGoTo }) {
  const list = useRef(null);

  // New moves land at the bottom of a scrolling list: keep the newest in sight.
  useEffect(() => {
    list.current.scrollTop = list.current.scrollHeight;
  }, [moves.length]);

  const rows = Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => i);
  const moveButton = (index) => {
    const san = moves[index];
    const target = index + 1;
    return (
      <button
        type="button"
        className={styles.san}
        aria-current={target === ply ? "step" : undefined}
        onClick={() => onGoTo(target)}
      >
        {san}
      </button>
    );
  };

  return (
    <div className={styles.moveHistory}>
      <h2 className={styles.panelTitle}>Moves</h2>
      <ol ref={list} className={styles.moves} aria-label="Move list">
        {rows.map((row) => (
          <li key={row}>
            <span className={styles.moveNumber} aria-hidden="true">
              {row + 1}.
            </span>
            {moveButton(row * 2)}
            {row * 2 + 1 < moves.length && moveButton(row * 2 + 1)}
          </li>
        ))}
      </ol>
      <div className={styles.navigation} role="group" aria-label="Move navigation">
        <button type="button" aria-label="First position" disabled={ply === 0} onClick={() => onGoTo(0)}>
          «
        </button>
        <button type="button" aria-label="Previous move" disabled={ply === 0} onClick={() => onGoTo(ply - 1)}>
          ‹
        </button>
        <button
          type="button"
          aria-label="Next move"
          disabled={ply === latest}
          onClick={() => onGoTo(ply + 1)}
        >
          ›
        </button>
        <button
          type="button"
          aria-label="Latest move"
          disabled={ply === latest}
          onClick={() => onGoTo(latest)}
        >
          »
        </button>
      </div>
      {ply < latest && (
        <p className={styles.browsing} role="status">
          Looking at move {ply} of {latest}.
        </p>
      )}
    </div>
  );
}
