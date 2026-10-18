import { useState } from "react";
import { Link } from "react-router";
import { ROOM_STATUS } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useAskReason } from "../../games/useAskReason.js";
import { useAction } from "../../hooks/useAction.js";
import { Button } from "../Button/Button.jsx";
import { RematchPanel } from "../Rematch/RematchPanel.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { actionBarItems, sendIntent } from "./matchShell.js";
import styles from "./MatchShell.module.css";

/**
 * One game action as a button. With `confirm` the press opens the shell's dialog first, and only its confirm button
 * sends the intent.
 */
function ActionButton({ action, reason, send }) {
  const run = useAction(() => sendIntent(action.intent, send), { id: action.control });
  const [confirming, setConfirming] = useState(false);
  const { confirm } = action;
  return (
    <>
      <Button
        control={action.control}
        variant={action.variant ?? "secondary"}
        action={run}
        reason={reason}
        onClick={confirm ? () => setConfirming(true) : undefined}
      >
        {action.label}
      </Button>
      {confirm && (
        <ConfirmDialog
          open={confirming}
          title={confirm.title}
          body={confirm.body}
          keepControl={`${action.control}.keep`}
          confirmControl={`${action.control}.confirm`}
          keepLabel={confirm.keepLabel}
          confirmLabel={confirm.confirmLabel}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            run.run();
          }}
        />
      )}
    </>
  );
}

/** A game action that asks the opponent something: it also waits while a request of its kind is open (CC-159). */
function AskButton({ room, action, offline, send }) {
  const askReason = useAskReason(room, action.intent.requestType);
  return <ActionButton action={action} reason={offline || action.reason || askReason} send={send} />;
}

/** A game action that sends a move, such as resigning. */
function MoveButton({ action, offline, send }) {
  return <ActionButton action={action} reason={offline || action.reason} send={send} />;
}

/**
 * The match's action bar (CC-157): the game's own actions and Leave while the game is on, and Rematch, New opponent
 * and Leave at the end. Leaving a game still on asks first, because it forfeits.
 *
 * @param {{
 *   room: any,
 *   game: import("../../games/registry.js").GameViewEntry,
 *   playLabel: string,
 *   offline: string,
 *   onMove: (move: object) => Promise<unknown>,
 *   onAsk: (type: string) => Promise<unknown>,
 *   onRoomAction: (action: import("../../games/roomUpdates.js").RoomAction) => Promise<unknown>,
 *   onWindowEnded: () => void,
 *   onLeave: () => Promise<unknown>,
 *   placement: "under-stage" | "in-result",
 * }} props  `room` is the RoomView. `playLabel`: the words on a spectator's link to the game's lobby. `offline`: "Reconnecting" while the connection is being restored, otherwise
 *   empty. `onLeave` gives the seat up and opens the game's lobby. `placement`: under the board as a row, or
 *   inside the result card as a column
 */
export function ActionBar({
  room,
  game,
  playLabel,
  offline,
  onMove,
  onAsk,
  onRoomAction,
  onWindowEnded,
  onLeave,
  placement,
}) {
  const leave = useAction(onLeave, { id: "room.leave" });
  const forfeit = useAction(onLeave, { id: "room.leave.confirm" });
  const newOpponent = useAction(onLeave, { id: "room.new_opponent" });
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const playing = room.status === ROOM_STATUS.PLAYING;
  const send = { onMove, onAsk };

  /** Draws one item of the bar. */
  function item(entry) {
    if (entry.kind === "game") {
      const Kind = entry.action.intent.type === "ask" ? AskButton : MoveButton;
      return (
        <Kind key={entry.action.control} room={room} action={entry.action} offline={offline} send={send} />
      );
    }
    if (entry.kind === "rematch") {
      return (
        <RematchPanel
          key="rematch"
          room={room}
          onAction={onRoomAction}
          onWindowEnded={onWindowEnded}
          reason={offline}
        />
      );
    }
    if (entry.kind === "new-opponent") {
      return (
        <Button
          key="new-opponent"
          control="room.new_opponent"
          variant="secondary"
          action={newOpponent}
          reason={offline}
        >
          New opponent
        </Button>
      );
    }
    if (entry.kind === "play-game") {
      return (
        <Link
          key="play-game"
          to={paths.game(room.gameId)}
          className={styles.again}
          data-cc-control="room.play_game"
        >
          {playLabel}
        </Link>
      );
    }
    // On the result card's tinted background a ghost button's text is too faint to read, so it gets a face there.
    return (
      <Button
        key="leave"
        control="room.leave"
        variant={placement === "in-result" ? "secondary" : "ghost"}
        action={leave}
        reason={offline}
        onClick={() => (playing ? setConfirmingLeave(true) : leave.run())}
      >
        Leave room
      </Button>
    );
  }

  return (
    <div
      className={`${styles.actionBar} ${placement === "in-result" ? styles.inResult : styles.underStage}`}
      data-cc-slot="action-bar"
    >
      {actionBarItems(room, game).map(item)}
      <ConfirmDialog
        open={confirmingLeave}
        title="Leave the game?"
        body="The game is still on. If you leave now, you forfeit and your opponent wins."
        keepControl="room.leave.stay"
        confirmControl="room.leave.confirm"
        keepLabel="Stay"
        confirmLabel="Leave and forfeit"
        onClose={() => setConfirmingLeave(false)}
        onConfirm={() => forfeit.run()}
        action={forfeit}
        reason={offline}
      />
    </div>
  );
}
