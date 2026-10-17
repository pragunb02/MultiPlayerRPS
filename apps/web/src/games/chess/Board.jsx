import { m } from "motion/react";
import { useReducedMotion } from "../../hooks/useReducedMotion.js";
import {
  boardRows,
  castlingRook,
  colourName,
  isDarkSquare,
  PIECE_NAMES,
  pieceImage,
  squareOffset,
} from "./chessGame.js";
import { PromotionPicker } from "./PromotionPicker.jsx";
import styles from "./Board.module.css";

const SLIDE = { duration: 0.18, ease: [0.22, 1, 0.36, 1] };

/**
 * Which pieces slide into place for the position on show, keyed by the square they land on. A move made by
 * dragging is already where it belongs, so nothing slides for it.
 *
 * @param {{ slide: { from: string, to: string, flags: string } | undefined, orientation: "w" | "b" }} input
 * @returns {Record<string, { x: number, y: number }>}
 */
function slidesFor({ slide, orientation }) {
  if (slide === undefined) {
    return {};
  }
  const rook = castlingRook(slide);
  // Stepping back through a castling move takes the rook home too.
  const rookSlide = rook && (slide.backward ? { from: rook.to, to: rook.from } : rook);
  const moves = [slide, rookSlide].filter(Boolean);
  return Object.fromEntries(moves.map(({ from, to }) => [to, squareOffset({ from, to, orientation })]));
}

function Piece({ piece, slide, lifted }) {
  const className = `${styles.piece} ${lifted ? styles.lifted : ""}`;
  const src = pieceImage(piece.color, piece.type);
  if (slide === undefined) {
    return <img className={className} src={src} alt="" draggable={false} />;
  }
  return (
    <m.img
      className={`${className} ${styles.sliding}`}
      src={src}
      alt=""
      draggable={false}
      initial={{ x: `${slide.x * 100}%`, y: `${slide.y * 100}%` }}
      animate={{ x: "0%", y: "0%" }}
      transition={SLIDE}
    />
  );
}

/**
 * The rank numbers down the left edge and the file letters along the bottom, in the colour of the other kind of
 * square so they read on both. They are drawn over the board, outside the square buttons: a number printed inside
 * a button would be part of what voice control users see as its label, yet not part of the name they say ("a8,
 * black rook"). Screen readers skip them because every square says where it is.
 */
function Coordinates({ rows }) {
  const tone = (square) => (isDarkSquare(square) ? styles.onDark : styles.onLight);
  return (
    <div className={styles.coords} aria-hidden="true">
      <div className={styles.rankCoords}>
        {rows.map(([first]) => (
          <span key={first} className={`${styles.coord} ${tone(first)}`}>
            {first[1]}
          </span>
        ))}
      </div>
      <div className={styles.fileCoords}>
        {rows[7].map((square) => (
          <span key={square} className={`${styles.coord} ${tone(square)}`}>
            {square[0]}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The 64 squares, the pieces and every marker on them. Each square is a button in a grid (screen readers read
 * "e4, white pawn, legal move"), and only one square is in the Tab order: the arrow keys, Home and End move
 * between them. The picked up piece's square is the grid's selected cell. A grid cell cannot be "pressed", so
 * `aria-pressed` would be ignored there (CC-183).
 *
 * @param {{
 *   chess: import("chess.js").Chess,
 *   orientation: "w" | "b",
 *   input: ReturnType<typeof import("./useBoardInput.js").useBoardInput>,
 *   interactive: boolean,
 *   colour: "w" | "b",
 *   lastMove: { from: string, to: string },
 *   slide: { from: string, to: string, flags: string, key: string, backward?: boolean } | undefined,
 * }} props
 */
export function Board({ chess, orientation, input, interactive, colour, lastMove, slide }) {
  const { attachBoard, attachGhost, handlers, promotion } = input;
  const rows = boardRows(orientation);
  // A player who asked for less motion sees pieces appear on their new square, with no slide at all.
  const slides = useReducedMotion() ? {} : slidesFor({ slide, orientation });
  const checkedKing = chess.inCheck()
    ? chess
        .board()
        .flat()
        .find((piece) => piece?.type === "k" && piece.color === chess.turn()).square
    : "";
  const boardClasses = [
    styles.board,
    interactive && styles.interactive,
    input.dragging !== "" && styles.dragging,
  ].filter(Boolean);
  const dragged = input.dragging === "" ? undefined : chess.get(input.dragging);

  return (
    <div className={styles.frame}>
      <div
        ref={attachBoard}
        className={boardClasses.join(" ")}
        role="grid"
        aria-label="Chess board"
        {...handlers}
      >
        {rows.map((row) => (
          <div role="row" key={row[0]} className={styles.rank}>
            {row.map((square) => {
              const piece = chess.get(square);
              const target = input.targets.find((move) => move.to === square);
              const classes = [
                styles.square,
                isDarkSquare(square) ? styles.dark : styles.light,
                (square === lastMove.from || square === lastMove.to) && styles.last,
                square === input.selected && styles.selected,
                square === input.dragging && styles.selected,
                square === checkedKing && styles.check,
                target && (piece ? styles.capture : styles.target),
                target && square === input.over && styles.over,
                interactive && piece?.color === colour && styles.movable,
              ].filter(Boolean);
              const name = piece ? `, ${colourName(piece.color)} ${PIECE_NAMES[piece.type]}` : "";
              return (
                <button
                  key={square}
                  type="button"
                  role="gridcell"
                  data-square={square}
                  data-cc-control="chess.square"
                  className={classes.join(" ")}
                  aria-label={`${square}${name}${target ? ", legal move" : ""}`}
                  aria-selected={square === input.selected}
                  aria-disabled={!interactive}
                  tabIndex={square === input.cursor ? 0 : -1}
                  onClick={(event) => input.click(square, event)}
                  onFocus={() => input.focus(square)}
                >
                  {piece && (
                    <Piece
                      key={slides[square] ? `${square}:${slide.key}` : square}
                      piece={piece}
                      slide={slides[square]}
                      lifted={square === input.dragging}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
        <Coordinates rows={rows} />
        {dragged && (
          <img
            ref={attachGhost}
            className={styles.ghost}
            src={pieceImage(dragged.color, dragged.type)}
            alt=""
            draggable={false}
          />
        )}
      </div>
      {promotion.to !== "" && (
        <PromotionPicker
          colour={colour}
          square={promotion.to}
          orientation={orientation}
          onChoose={input.choosePromotion}
          onCancel={input.cancelPromotion}
        />
      )}
    </div>
  );
}
