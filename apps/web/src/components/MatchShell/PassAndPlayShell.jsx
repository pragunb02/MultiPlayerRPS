import { useState } from "react";
import { ROOM_STATUS } from "@classicade/shared";
import { resultHeadline } from "../../games/outcomeText.js";
import { textsFor } from "../../games/roomUpdates.js";
import { nameOf } from "../../games/roomView.js";
import { useLocalMatch } from "../../hooks/useLocalMatch.js";
import { Button } from "../Button/Button.jsx";
import { outcomeFor } from "../Celebrations/outcome.js";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { MatchFrame, MatchStage } from "./MatchFrame.jsx";
import styles from "./MatchShell.module.css";
import passStyles from "./PassAndPlayShell.module.css";

/** Said on every result of a game on one phone, because nothing about it reaches the server (ADR-021). */
export const NOT_COUNTED_NOTE = "Not counted: games on one phone give no XP, quests or leaderboard places.";

const otherName = (room, playerId) => room.seats.find((seat) => seat.playerId !== playerId).displayName;

/**
 * The screen that covers the board while the phone changes hands (CC-223). It names who takes the phone, tells the
 * other player to look away, and says how the last turn went when the game has something both may see. The board
 * is not in the page while it shows, so a secret choice is never on screen for the wrong person.
 */
function HandOver({ room, holder, note, onReady }) {
  const name = nameOf(room, holder);
  return (
    <section
      className={`${styles.card} ${passStyles.handOver}`}
      aria-labelledby="hand-over-heading"
      data-cc-slot="hand-over"
    >
      {note !== "" && <p className={passStyles.note}>{note}</p>}
      <h2 id="hand-over-heading">Pass the phone to {name}</h2>
      <p>
        {otherName(room, holder)}, look away. {name} chooses next, and the choice stays hidden.
      </p>
      <Button control="pass.ready" size="lg" onClick={onReady}>
        I&apos;m {name}, show my turn
      </Button>
    </section>
  );
}

/**
 * A game action as a button, for two people on one phone. A move, such as resigning, goes to the engine at once,
 * after the game's own confirmation when it has one. A request, such as a draw offer, is answered in person: the
 * dialog asks the other player, and only their yes reaches the engine.
 */
function LocalAction({ room, action, onMove, onAccept }) {
  const [open, setOpen] = useState(false);
  const { intent } = action;
  const asking = intent.type === "ask";
  const texts = asking ? textsFor(room.gameId, intent.requestType) : undefined;
  const confirm = asking
    ? {
        title: texts.title,
        body: `${texts.question(nameOf(room, room.you))} ${otherName(room, room.you)}, do you accept?`,
        confirmLabel: "Accept",
        keepLabel: "Decline",
      }
    : action.confirm;
  const run = () => (asking ? onAccept(intent.requestType) : onMove(intent.move));
  return (
    <>
      <Button
        control={action.control}
        variant={action.variant ?? "secondary"}
        reason={action.reason}
        onClick={() => (confirm ? setOpen(true) : run())}
      >
        {action.label}
      </Button>
      {confirm && (
        <ConfirmDialog
          open={open}
          title={confirm.title}
          body={confirm.body}
          keepControl={`${action.control}.keep`}
          confirmControl={`${action.control}.confirm`}
          keepLabel={confirm.keepLabel}
          confirmLabel={confirm.confirmLabel}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            run();
          }}
        />
      )}
    </>
  );
}

/**
 * The buttons of a local game. While it is on: the game's own actions and Leave, which asks first because the game
 * is not kept. At the end: Play again with the same names, and Back to the lobby.
 */
function LocalActionBar({ room, game, onMove, onAccept, onPlayAgain, onLeave }) {
  const [leaving, setLeaving] = useState(false);
  const playing = room.status === ROOM_STATUS.PLAYING;
  const own = playing && game.actions ? game.actions(room) : [];
  return (
    <div
      className={`${styles.actionBar} ${playing ? styles.underStage : styles.inResult}`}
      data-cc-slot="action-bar"
    >
      {own.map((action) => (
        <LocalAction key={action.control} room={room} action={action} onMove={onMove} onAccept={onAccept} />
      ))}
      {!playing && (
        <Button control="pass.play_again" size="lg" onClick={onPlayAgain}>
          Play again
        </Button>
      )}
      <Button
        control="pass.leave"
        variant={playing ? "ghost" : "secondary"}
        onClick={() => (playing ? setLeaving(true) : onLeave())}
      >
        {playing ? "Leave game" : "Back to the lobby"}
      </Button>
      <ConfirmDialog
        open={leaving}
        title="Leave this game?"
        body="A game on one phone is not saved. If you leave now, it is gone."
        keepControl="pass.leave.stay"
        confirmControl="pass.leave.confirm"
        keepLabel="Stay"
        confirmLabel="Leave"
        onClose={() => setLeaving(false)}
        onConfirm={onLeave}
      />
    </div>
  );
}

/** A board never asks the server for anything here: a request is answered in person, through the action bar. */
const askNobody = () => Promise.resolve();

/**
 * Pass and play in the match frame (CC-223, ADR-049): two people take turns on one phone, and the game runs on the
 * phone with the same engine as the server. It fills the frame's slots itself, without the parts that only a room
 * has: no request banner, no presence, no rematch and no rewards. The board is the game's own, drawn from a RoomView
 * seen by whoever holds the phone. In a game that keeps a move secret, a "pass the phone" screen covers the board
 * whenever the phone must change hands. Every result says it was not counted.
 *
 * @param {{
 *   gameId: string,
 *   gameName: string,
 *   game: import("../../games/registry.js").GameViewEntry,
 *   engine: Readonly<import("@classicade/games").GameEngine<any, any, any>>,
 *   names: ReadonlyArray<string>,
 *   options: object,
 *   onLeave: () => void,
 * }} props  `game` is the game's registry entry, with `passAndPlay`. `names` and `options` are read once.
 *   `onLeave` opens the game's lobby
 */
export function PassAndPlayShell({ gameId, gameName, game, engine, names, options, onLeave }) {
  const match = useLocalMatch({ engine, names, options });
  const { room, holder } = match;
  const finished = room.status === ROOM_STATUS.FINISHED;
  const covered = game.passAndPlay.handOver && match.covered;
  const note = game.passAndPlay.handOverNote?.(room) ?? "";
  const phase = finished ? "finished" : covered ? "hand-over" : "playing";

  return (
    <MatchFrame
      pageTitle={`${gameName} · Pass and play`}
      gameId={gameId}
      gameName={gameName}
      phase={phase}
      score={finished ? "Not counted" : `${nameOf(room, holder)}'s turn`}
      result={
        finished
          ? {
              tone: outcomeFor(room),
              headline: resultHeadline(room),
              note: (
                <p className={passStyles.notCounted} data-cc-slot="not-counted">
                  {NOT_COUNTED_NOTE}
                </p>
              ),
            }
          : undefined
      }
      stage={
        covered ? (
          <HandOver room={room} holder={holder} note={note} onReady={match.uncover} />
        ) : (
          <MatchStage room={room} game={game} onMove={match.move} onAsk={askNobody} reconnecting={false} />
        )
      }
      actionBar={
        <LocalActionBar
          room={room}
          game={game}
          onMove={match.move}
          onAccept={match.accept}
          onPlayAgain={match.playAgain}
          onLeave={onLeave}
        />
      }
      side={
        <div className={`${styles.card} ${passStyles.players}`} data-cc-slot="presence">
          <h2>Players</h2>
          <ul aria-label="Players">
            {room.seats.map((seat) => (
              <li key={seat.playerId}>
                {seat.displayName}
                {seat.playerId === holder && <span className={passStyles.tag}>to play</span>}
              </li>
            ))}
          </ul>
          <p className={passStyles.privacy}>
            Names stay on this phone. Nothing about this game is sent or saved.
          </p>
        </div>
      }
    />
  );
}
