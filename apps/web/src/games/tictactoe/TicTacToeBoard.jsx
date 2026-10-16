import { TurnBanner } from "../../components/TurnBanner/TurnBanner.jsx";
import { useMove } from "../useMove.js";
import styles from "./TicTacToeBoard.module.css";

const ROWS = ["top", "middle", "bottom"];
const COLUMNS = ["left", "centre", "right"];
const cellName = (index) => `${ROWS[Math.floor(index / 3)]} ${COLUMNS[index % 3]}`;

/**
 * Tic-Tac-Toe: a 3×3 grid of buttons. The server decides legality and the result; the board only sends
 * `{ cell }` and shows what the server says.
 *
 * @param {{ room: any, onMove: (move: { cell: number }) => Promise<unknown> }} props
 */
export function TicTacToeBoard({ room, onMove }) {
  const { view } = room.game;
  const move = useMove(onMove);
  const yourMark = view.marks[room.you];
  const yourTurn = room.status === "playing" && view.turn === room.you && !move.busy;
  const winning = new Set(view.winningLine);

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
              return (
                <button
                  key={index}
                  type="button"
                  role="gridcell"
                  className={`${styles.cell} ${mark ? styles[mark] : ""} ${winning.has(index) ? styles.win : ""}`}
                  aria-label={`${cellName(index)}: ${mark || "empty"}`}
                  disabled={!yourTurn || mark !== ""}
                  onClick={() => move.send({ cell: index })}
                >
                  {mark}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {move.error !== "" && (
        <p role="alert" className={styles.error}>
          {move.error}
        </p>
      )}
    </div>
  );
}
