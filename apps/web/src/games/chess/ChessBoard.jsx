import { Chess } from "chess.js";
import { useMemo, useState } from "react";
import { CHESS_ACTIONS } from "@classicade/shared";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { TurnBanner } from "../../components/TurnBanner/TurnBanner.jsx";
import { useMove } from "../useMove.js";
import { formatClock, useChessClocks } from "./useChessClocks.js";
import styles from "./ChessBoard.module.css";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const PROMOTIONS = ["q", "r", "b", "n"];
const colourName = (c) => (c === "w" ? "white" : "black");

/**
 * Chess with click-to-move. chess.js runs on the client only to *highlight* legal moves; the server validates
 * every move and decides the result.
 *
 * @param {{ room: any, onMove: (move: object) => Promise<unknown> }} props
 */
export function ChessBoard({ room, onMove }) {
  const { view } = room.game;
  const move = useMove(onMove);
  const chess = useMemo(() => new Chess(view.fen), [view.fen]);
  const [selected, setSelected] = useState("");
  const [promotion, setPromotion] = useState(undefined);
  const [confirmResign, setConfirmResign] = useState(false);

  const playing = room.status === "playing";
  const yourColour = view.colors[room.you] ?? "w";
  const opponentId = room.seats.find((seat) => seat.playerId !== room.you)?.playerId ?? "";
  const yourTurn = playing && view.toMove === room.you && !move.busy;
  const running = playing && view.lastMoveAt > 0 ? chess.turn() : "";
  const clocks = useChessClocks({
    clocks: view.clocks,
    lastMoveAt: view.lastMoveAt,
    running,
    serverTime: room.serverTime,
  });

  const ranks = yourColour === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = yourColour === "w" ? FILES : [...FILES].reverse();
  const targets = selected === "" ? [] : chess.moves({ square: selected, verbose: true });
  const checkedKing =
    view.inCheck &&
    chess
      .board()
      .flat()
      .find((piece) => piece?.type === "k" && piece.color === chess.turn())?.square;

  // Squares are disabled unless it is your turn, so a click always comes from the player to move.
  function clickSquare(square) {
    const piece = chess.get(square);
    if (piece && piece.color === yourColour) {
      setSelected(square === selected ? "" : square);
      return;
    }
    const candidates = targets.filter((m) => m.to === square);
    if (candidates.length === 0) {
      setSelected("");
      return;
    }
    if (candidates.some((m) => m.promotion)) {
      setPromotion({ from: selected, to: square });
      return;
    }
    setSelected("");
    move.send({ type: CHESS_ACTIONS.MOVE, from: selected, to: square });
  }

  function promote(piece) {
    const { from, to } = promotion;
    setPromotion(undefined);
    setSelected("");
    move.send({ type: CHESS_ACTIONS.MOVE, from, to, promotion: piece });
  }

  const nameOf = (playerId) =>
    playerId === room.you
      ? "You"
      : (room.seats.find((s) => s.playerId === playerId)?.displayName ?? "Opponent");
  const clock = (colour) => (
    <div className={`${styles.clock} ${running === colour ? styles.running : ""}`}>
      <span>{nameOf(view.colors && Object.keys(view.colors).find((id) => view.colors[id] === colour))}</span>
      <span className={styles.time} role="timer" aria-label={`${colourName(colour)} clock`}>
        {formatClock(clocks[colour])}
      </span>
    </div>
  );
  const opponentColour = yourColour === "w" ? "b" : "w";

  return (
    <div className={styles.layout}>
      <div className={styles.boardColumn}>
        <TurnBanner room={room} />
        {clock(opponentColour)}
        <div className={styles.board} role="grid" aria-label="Chess board">
          {ranks.map((rank) => (
            <div role="row" key={rank} className={styles.rank}>
              {files.map((file) => {
                const square = `${file}${rank}`;
                const piece = chess.get(square);
                const dark = (FILES.indexOf(file) + rank) % 2 === 1;
                const isTarget = targets.some((m) => m.to === square);
                const classes = [
                  styles.square,
                  dark ? styles.dark : styles.light,
                  square === selected && styles.selected,
                  (square === view.lastMove.from || square === view.lastMove.to) && styles.last,
                  square === checkedKing && styles.check,
                  isTarget && (piece ? styles.capture : styles.target),
                ].filter(Boolean);
                return (
                  <button
                    key={square}
                    type="button"
                    role="gridcell"
                    className={classes.join(" ")}
                    aria-label={`${square}${piece ? `, ${colourName(piece.color)} ${PIECE_NAMES[piece.type]}` : ""}${isTarget ? ", legal move" : ""}`}
                    aria-pressed={square === selected}
                    disabled={!yourTurn}
                    onClick={() => clickSquare(square)}
                  >
                    {piece && (
                      <img
                        src={`/pieces/${piece.color}${piece.type.toUpperCase()}.png`}
                        alt=""
                        draggable={false}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {clock(yourColour)}
        {move.error !== "" && (
          <p role="alert" className={styles.error}>
            {move.error}
          </p>
        )}
      </div>

      <aside className={styles.panel}>
        <h2 className={styles.panelTitle}>Moves</h2>
        <ol className={styles.moves}>
          {Array.from({ length: Math.ceil(view.moves.length / 2) }, (_, i) => (
            <li key={i}>
              <span>{view.moves[i * 2]}</span>
              <span>{view.moves[i * 2 + 1] ?? ""}</span>
            </li>
          ))}
        </ol>
        {playing && (
          <div className={styles.actions}>
            {view.drawOfferBy === opponentId && opponentId !== "" ? (
              <>
                <p className={styles.offer}>{nameOf(opponentId)} offers a draw.</p>
                <Button onClick={() => move.send({ type: CHESS_ACTIONS.ACCEPT_DRAW })}>Accept draw</Button>
              </>
            ) : (
              <Button
                variant="secondary"
                disabled={view.drawOfferBy === room.you}
                onClick={() => move.send({ type: CHESS_ACTIONS.OFFER_DRAW })}
              >
                {view.drawOfferBy === room.you ? "Draw offered" : "Offer draw"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setConfirmResign(true)}>
              Resign
            </Button>
          </div>
        )}
      </aside>

      <Modal
        open={promotion !== undefined}
        title="Promote to"
        onClose={() => setPromotion(undefined)}
        actions={PROMOTIONS.map((piece) => (
          <Button
            key={piece}
            variant="secondary"
            onClick={() => promote(piece)}
            aria-label={PIECE_NAMES[piece]}
          >
            <img src={`/pieces/${yourColour}${piece.toUpperCase()}.png`} alt="" width="32" height="32" />
          </Button>
        ))}
      >
        <p>Choose the piece your pawn becomes.</p>
      </Modal>
      <Modal
        open={confirmResign}
        title="Resign this game?"
        onClose={() => setConfirmResign(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmResign(false)}>
              Keep playing
            </Button>
            <Button
              onClick={() => {
                setConfirmResign(false);
                move.send({ type: CHESS_ACTIONS.RESIGN });
              }}
            >
              Resign
            </Button>
          </>
        }
      >
        <p>Your opponent will win the game.</p>
      </Modal>
    </div>
  );
}
