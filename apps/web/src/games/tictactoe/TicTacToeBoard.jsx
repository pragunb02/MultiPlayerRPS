import { MarkO } from "../../art/tictactoe/MarkO.jsx";
import { MarkX } from "../../art/tictactoe/MarkX.jsx";
import { TurnBanner } from "../../components/TurnBanner/TurnBanner.jsx";
import { useExplanation } from "../../hooks/useExplanation.js";
import { MoveProblem, ReasonLine } from "../BoardFeedback.jsx";
import { playReason } from "../roomView.js";
import { useMove } from "../useMove.js";
import styles from "./TicTacToeBoard.module.css";

const ROWS = ["top", "middle", "bottom"];
const COLUMNS = ["left", "centre", "right"];
const cellName = (index) => `${ROWS[Math.floor(index / 3)]} ${COLUMNS[index % 3]}`;
// Each mark draws itself in when placed; a mark this version doesn't know is shown as its letter.
const MARKS = Object.freeze({ X: MarkX, O: MarkO });

function Mark({ mark }) {
  const Drawn = MARKS[mark];
  return Drawn ? <Drawn className={styles.markArt} /> : mark;
}

/**
 * Tic-Tac-Toe: a 3×3 grid of buttons. The server decides legality and the result. The board only sends
 * `{ cell }` and shows what the server says. The pressed cell shows your mark at once, faintly, until the server
 * answers. A cell that cannot be played says why when pressed (CC-164).
 *
 * @param {{ room: any, onMove: (move: { cell: number }) => Promise<unknown>, reason?: string }} props
 *   `reason`: why the viewer cannot play now (see playReason), empty when they can
 */
export function TicTacToeBoard({ room, onMove, reason = playReason(room, { reconnecting: false }) }) {
  const { view } = room.game;
  const move = useMove(onMove, { id: "ttt.cell" });
  const explanation = useExplanation();
  const yourMark = view.marks[room.you];
  const winning = new Set(view.winningLine);

  /** Why this cell cannot be played now, or "" when it can. */
  function cellReason(mark) {
    if (reason !== "") return reason;
    if (mark !== "") return "Cell taken";
    if (move.busy) return "Sending your move";
    return "";
  }

  function press(index, why) {
    if (why !== "") {
      explanation.explain(why);
      return;
    }
    move.send({ cell: index });
  }

  return (
    <div className={styles.wrap}>
      <TurnBanner room={room} />
      {yourMark && <p className={styles.mark}>You play {yourMark}</p>}
      <div className={styles.grid} role="grid" aria-label="Tic-Tac-Toe board">
        {[0, 1, 2].map((row) => (
          <div role="row" key={row} className={styles.row}>
            {[0, 1, 2].map((column) => {
              const index = row * 3 + column;
              const mark = view.board[index];
              const why = cellReason(mark);
              const sending = move.sent?.cell === index;
              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className={`${styles.cell} ${mark ? styles[mark] : ""} ${winning.has(index) ? styles.win : ""} ${sending ? `${styles[yourMark]} ${styles.sending}` : ""}`}
                  aria-label={`${cellName(index)}: ${mark || (sending ? `${yourMark}, sending` : "empty")}`}
                  aria-disabled={why !== "" ? "true" : undefined}
                  aria-busy={sending && move.pending ? "true" : undefined}
                  data-cc-control="ttt.cell"
                  onClick={() => press(index, why)}
                >
                  <Mark mark={mark || (sending ? yourMark : "")} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <ReasonLine explanation={explanation} />
      <MoveProblem move={move} />
    </div>
  );
}
