import { useEffect, useRef } from "react";
import { boardRows, PIECE_NAMES, pieceImage, PROMOTION_PIECES } from "./chessGame.js";
import styles from "./Board.module.css";

/**
 * The piece choice for a pawn reaching the last rank, drawn over the board like on the big chess sites: the
 * four pieces stand in a column on the promotion square's file, starting at that square, and the rest of the
 * board dims. Clicking the dimmed board or pressing Escape takes the move back.
 *
 * @param {{ colour: "w" | "b", square: string, orientation: "w" | "b", onChoose: (piece: string) => void, onCancel: () => void }} props
 */
export function PromotionPicker({ colour, square, orientation, onChoose, onCancel }) {
  const first = useRef(null);
  const top = boardRows(orientation)[0];
  const column = top.findIndex((s) => s[0] === square[0]);
  const atTop = top[0][1] === square[1];

  useEffect(() => first.current.focus(), []);
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className={styles.promotionBackdrop} onClick={onCancel}>
      <div
        role="dialog"
        aria-label="Promote to"
        className={`${styles.promotion} ${styles[`column${column}`]} ${atTop ? styles.fromTop : styles.fromBottom}`}
        onClick={(event) => event.stopPropagation()}
      >
        {PROMOTION_PIECES.map((piece, i) => (
          <button
            key={piece}
            ref={i === 0 ? first : undefined}
            type="button"
            className={styles.promotionChoice}
            data-cc-control="chess.promote"
            aria-label={PIECE_NAMES[piece]}
            onClick={() => onChoose(piece)}
          >
            <img src={pieceImage(colour, piece)} alt="" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}
