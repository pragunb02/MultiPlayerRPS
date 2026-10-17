import { Chess } from "chess.js";
import { useEffect, useMemo, useState } from "react";
import { CHESS_ACTIONS } from "@classicade/shared";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { MotionProvider } from "../../components/Motion/MotionProvider.jsx";
import { TurnBanner } from "../../components/TurnBanner/TurnBanner.jsx";
import { useMove } from "../useMove.js";
import { Board } from "./Board.jsx";
import { materialBalance, opposite, positionWithMove, replayGame } from "./chessGame.js";
import { GameOver } from "./GameOver.jsx";
import { MoveList } from "./MoveList.jsx";
import { LOW_TIME_MS, PlayerBar } from "./PlayerBar.jsx";
import { useBoardInput } from "./useBoardInput.js";
import { useChessClocks } from "./useChessClocks.js";
import styles from "./ChessBoard.module.css";

const FORM_FIELDS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/**
 * The positions of the game, oldest first. Earlier ones come from replaying the move list, the newest is the
 * server's own position. A move the player has just made and the server has not confirmed yet is shown on top
 * of that, so a slow connection never makes the piece jump back while the move travels.
 */
function useTimeline(view, pending) {
  const { positions } = useMemo(() => replayGame(view.moves), [view.moves]);
  return useMemo(() => {
    const newest = {
      ...positions.at(-1),
      fen: view.fen,
      from: view.lastMove.from ?? "",
      to: view.lastMove.to ?? "",
    };
    const confirmed = [...positions.slice(0, -1), newest];
    // The pending move belongs to the position it was made in. Once the server's next view arrives it is history.
    return pending.fen === view.fen ? [...confirmed, positionWithMove(view.fen, pending.move)] : confirmed;
  }, [positions, view.fen, view.lastMove, pending]);
}

/**
 * Which way pieces slide for the position on show: forward when the next position appears (a move arriving,
 * or stepping forward through the history), backward when stepping back. Nothing slides when the board first
 * appears or jumps several moves, and a dropped piece is already in place.
 */
function useSlide(timeline, shown, dropped) {
  const position = timeline[shown];
  const [trail, setTrail] = useState({ ply: shown, position, slide: undefined });
  if (trail.ply !== shown) {
    const forward =
      shown === trail.ply + 1 && !(position.from === dropped.from && position.to === dropped.to);
    const backward = shown === trail.ply - 1;
    const slide = forward
      ? { from: position.from, to: position.to, flags: position.flags, key: `f${shown}` }
      : backward
        ? {
            from: trail.position.to,
            to: trail.position.from,
            flags: trail.position.flags,
            key: `b${shown}`,
            backward: true,
          }
        : undefined;
    setTrail({ ply: shown, position, slide });
  }
  return trail.slide;
}

/**
 * Chess: drag and drop or click to move, arrow keys and Enter on the keyboard, the game's history to look back
 * through, captured pieces, clocks and the result with a PGN download. chess.js runs here only to show legal
 * moves and earlier positions. The server checks every move and decides the result.
 *
 * @param {{ room: any, onMove: (move: object) => Promise<unknown>, site?: string }} props
 *   `site`: written into the PGN, defaults to this page's origin
 */
export function ChessBoard({ room, onMove, site = window.location.origin }) {
  const { view } = room.game;
  const move = useMove(onMove);
  const [pending, setPending] = useState({ fen: "", move: { from: "", to: "" } });
  const [dropped, setDropped] = useState({ from: "", to: "" });
  const [browse, setBrowse] = useState({ follow: true, ply: 0 });
  const [confirmResign, setConfirmResign] = useState(false);

  const playing = room.status === "playing";
  const seated = room.you !== "";
  const yourColour = seated ? view.colors[room.you] : "";
  const [orientation, setOrientation] = useState(yourColour === "b" ? "b" : "w");

  const timeline = useTimeline(view, pending);
  const latest = timeline.length - 1;
  const shown = browse.follow ? latest : Math.min(browse.ply, latest);
  const position = timeline[shown];
  const chess = useMemo(() => new Chess(position.fen), [position.fen]);
  const slide = useSlide(timeline, shown, dropped);

  const yourTurn = playing && seated && view.toMove === room.you && !move.busy;
  const interactive = yourTurn && shown === latest;
  const opponentId = room.seats.find((seat) => seat.playerId !== room.you)?.playerId ?? "";

  const byColour = (colour) => Object.keys(view.colors).find((id) => view.colors[id] === colour) ?? "";
  const seatName = (playerId) =>
    room.seats.find((seat) => seat.playerId === playerId)?.displayName ?? "Opponent";
  const names = { w: seatName(byColour("w")), b: seatName(byColour("b")) };
  const shownName = (colour) => (colour === yourColour ? "You" : names[colour]);

  const running = playing && view.lastMoveAt > 0 ? view.fen.split(" ")[1] : "";
  const clocks = useChessClocks({
    clocks: view.clocks,
    lastMoveAt: view.lastMoveAt,
    running,
    serverTime: room.serverTime,
  });
  const balance = materialBalance(position.fen);

  async function play(boardMove, { dragged }) {
    setDropped(dragged ? boardMove : { from: "", to: "" });
    setPending({ fen: view.fen, move: boardMove });
    await move.send({ type: CHESS_ACTIONS.MOVE, ...boardMove });
    setPending({ fen: "", move: { from: "", to: "" } });
  }

  const input = useBoardInput({
    chess,
    colour: yourColour === "" ? "w" : yourColour,
    orientation,
    interactive,
    onMove: play,
  });

  const goTo = (ply) => setBrowse({ follow: ply >= latest, ply });

  // Left and right arrows step through the moves, as on the big chess sites, unless the board or a form
  // field has the keyboard (the board uses arrows to move between squares).
  useEffect(() => {
    const onKey = (event) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      const target = event.target;
      if (step === undefined || FORM_FIELDS.has(target.tagName) || target.closest("[role='grid']")) {
        return;
      }
      event.preventDefault();
      const next = Math.max(0, Math.min(latest, shown + step));
      setBrowse({ follow: next === latest, ply: next });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [latest, shown]);

  const bar = (colour) => (
    <PlayerBar
      name={shownName(colour)}
      colour={colour}
      ms={clocks[colour]}
      running={running === colour}
      live={playing}
      captured={balance.captured[colour]}
      advantage={balance.advantage[colour]}
    />
  );
  const lowOnTime = playing && yourColour !== "" && clocks[yourColour] < LOW_TIME_MS;
  const mover = opposite(view.fen.split(" ")[1]);
  const lastMoveText = view.moves.length > 0 ? `${shownName(mover)} played ${view.moves.at(-1)}` : "";

  return (
    <MotionProvider>
      <div className={styles.layout}>
        <div className={styles.boardColumn}>
          <TurnBanner room={room} />
          {bar(opposite(orientation))}
          <Board
            chess={chess}
            orientation={orientation}
            input={input}
            interactive={interactive}
            colour={yourColour === "" ? "w" : yourColour}
            lastMove={position}
            slide={slide}
          />
          {bar(orientation)}
          <div className={styles.toolbar}>
            <Button variant="ghost" onClick={() => setOrientation(opposite(orientation))}>
              Flip board
            </Button>
          </div>
          {move.error !== "" && (
            <p role="alert" className={styles.error}>
              {move.error}
            </p>
          )}
          <p className="visually-hidden" aria-live="polite">
            {lastMoveText}
          </p>
          <p className="visually-hidden" aria-live="assertive">
            {lowOnTime ? "Less than 20 seconds left on your clock" : ""}
          </p>
        </div>

        <aside className={styles.panel}>
          {room.status === "finished" && (
            <GameOver room={room} names={names} yourColour={yourColour} site={site} />
          )}
          <MoveList moves={timeline.slice(1).map((p) => p.san)} ply={shown} latest={latest} onGoTo={goTo} />
          {playing && seated && (
            <div className={styles.actions}>
              {view.drawOfferBy === opponentId && opponentId !== "" ? (
                <>
                  <p className={styles.offer}>{seatName(opponentId)} offers a draw.</p>
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
    </MotionProvider>
  );
}
