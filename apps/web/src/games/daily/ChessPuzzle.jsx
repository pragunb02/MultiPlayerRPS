import { Chess } from "chess.js";
import { useMemo, useState } from "react";
import { DAILY_PUZZLE_STATUS } from "@classicade/shared";
import { MotionProvider } from "../../components/Motion/MotionProvider.jsx";
import { useExplanation } from "../../hooks/useExplanation.js";
import { ReasonLine } from "../BoardFeedback.jsx";
import { Board } from "../chess/Board.jsx";
import { colourName, positionWithMove } from "../chess/chessGame.js";
import { useBoardInput } from "../chess/useBoardInput.js";
import styles from "./ChessPuzzle.module.css";

const NO_MOVE = Object.freeze({ fen: "", move: { from: "", to: "" } });

/**
 * The board of the daily chess puzzle (CC-144). It is the chess board of the rooms: click or tap a piece and then
 * a square, drag it, or walk the squares with the arrow keys and press Enter. Only legal moves are sent. The server
 * says whether a move is the one to find, so a wrong move snaps back when its answer comes. The opponent's last move
 * slides in, and under reduced motion it just appears.
 *
 * @param {{
 *   puzzle: any,
 *   interactive: boolean,
 *   reason: string,
 *   onMove: (move: { from: string, to: string, promotion?: string }) => Promise<unknown>,
 * }} props  puzzle: the server's view of today's puzzle. reason: why the board cannot take a move now, empty when
 *   it can
 */
export function ChessPuzzle({ puzzle, interactive, reason, onMove }) {
  const { position } = puzzle;
  const explanation = useExplanation();
  const [sent, setSent] = useState(NO_MOVE);
  // A move on its way shows on the board at once, and goes when the answer comes.
  const shown = sent.fen === position.fen ? positionWithMove(position.fen, sent.move) : undefined;
  const fen = shown?.fen ?? position.fen;
  const chess = useMemo(() => new Chess(fen), [fen]);
  const lastMove = shown ?? position.lastMove;
  // Each new position slides its last move in, the opponent's reply included. The key changes with every move.
  const slide =
    shown === undefined
      ? { from: position.lastMove.from, to: position.lastMove.to, flags: "", key: `${position.line.length}` }
      : undefined;
  const open = interactive && sent.fen === "" && puzzle.status !== DAILY_PUZZLE_STATUS.SOLVED;

  async function play(move) {
    setSent({ fen: position.fen, move });
    try {
      await onMove(move);
    } finally {
      setSent(NO_MOVE);
    }
  }

  function refuse(why) {
    if (why === "not-yours") {
      explanation.explain(`Pick one of the ${colourName(position.player)} pieces`);
    } else if (why === "illegal") {
      explanation.explain("That move is not allowed");
    } else {
      explanation.explain(reason === "" ? "Sending your move" : reason);
    }
  }

  const input = useBoardInput({
    chess,
    colour: position.player,
    orientation: position.player,
    interactive: open,
    onMove: play,
    onRefuse: refuse,
  });

  return (
    <MotionProvider>
      <div className={styles.board}>
        <Board
          chess={chess}
          orientation={position.player}
          input={input}
          interactive={open}
          colour={position.player}
          lastMove={lastMove}
          slide={slide}
        />
        <ReasonLine explanation={explanation} />
      </div>
    </MotionProvider>
  );
}
