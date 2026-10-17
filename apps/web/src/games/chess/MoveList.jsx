import { useEffect, useRef } from "react";
import { useExplanation } from "../../hooks/useExplanation.js";
import { ReasonLine } from "../BoardFeedback.jsx";
import styles from "./ChessBoard.module.css";

/**
 * One of the four buttons that step through the game. At either end of the game it cannot go further, and a press
 * says so instead of doing nothing (CC-164).
 */
function Step({ control, label, symbol, reason, onGo, onRefuse }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={reason !== "" ? "true" : undefined}
      data-cc-control={control}
      onClick={() => (reason === "" ? onGo() : onRefuse(reason))}
    >
      {symbol}
    </button>
  );
}

/**
 * The moves in chess notation (like e4 or Nf3), two per numbered row, and buttons to look back through the
 * game. Looking back only changes what this player sees. The game goes on, and "Latest move" returns to it.
 *
 * @param {{ moves: ReadonlyArray<string>, ply: number, latest: number, onGoTo: (ply: number) => void }} props
 *   `ply`: the position on show (0 is the start), `latest`: the newest position
 */
export function MoveList({ moves, ply, latest, onGoTo }) {
  const list = useRef(null);
  const explanation = useExplanation();
  const atStart = ply === 0 ? "This is the first position" : "";
  const atEnd = ply === latest ? "This is the latest move" : "";

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
        data-cc-control="chess.moves.go"
        aria-current={target === ply ? "step" : undefined}
        onClick={() =>
          target === ply ? explanation.explain("This move is on the board now") : onGoTo(target)
        }
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
        <Step
          control="chess.moves.first"
          label="First position"
          symbol="«"
          reason={atStart}
          onGo={() => onGoTo(0)}
          onRefuse={explanation.explain}
        />
        <Step
          control="chess.moves.previous"
          label="Previous move"
          symbol="‹"
          reason={atStart}
          onGo={() => onGoTo(ply - 1)}
          onRefuse={explanation.explain}
        />
        <Step
          control="chess.moves.next"
          label="Next move"
          symbol="›"
          reason={atEnd}
          onGo={() => onGoTo(ply + 1)}
          onRefuse={explanation.explain}
        />
        <Step
          control="chess.moves.latest"
          label="Latest move"
          symbol="»"
          reason={atEnd}
          onGo={() => onGoTo(latest)}
          onRefuse={explanation.explain}
        />
      </div>
      <ReasonLine explanation={explanation} />
      {ply < latest && (
        <p className={styles.browsing} role="status">
          Looking at move {ply} of {latest}.
        </p>
      )}
    </div>
  );
}
