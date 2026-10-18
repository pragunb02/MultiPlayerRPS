import { ROOM_STATUS } from "@classicade/shared";

/**
 * The rules of the match frame (CC-157, ADR-049): which slots a room shows and where, and which buttons go in the
 * action bar. They are pure functions of the RoomView and the game's registry entry, so the shell component only
 * draws what they say.
 */

/**
 * A button a game puts in the action bar, as data. The shell draws every action the same way: the same button, the
 * same reasons and, when `confirm` is given, the same confirmation dialog.
 *
 * @typedef {Object} GameAction
 * @property {string} control  the `data-cc-control` name, unique in the game, such as "chess.resign". The dialog's
 *   buttons are named after it with ".keep" and ".confirm"
 * @property {string} label  the words on the button
 * @property {string} reason  why the game does not allow the action now, empty when it does. The shell adds its own
 *   reasons on top: reconnecting, and for a request one already open or the pause after an answer
 * @property {{ type: "move", move: object } | { type: "ask", requestType: string }} intent  what the button sends:
 *   a move for the game, or a request to the opponent such as a draw offer
 * @property {{ title: string, body: string, confirmLabel: string, keepLabel: string }} [confirm]  asks first
 * @property {"secondary" | "ghost"} [variant]  how the button looks, "secondary" when not given
 */

/** At most four buttons fit in the action bar on a phone, Leave included (BGA's guideline, CC-157). */
export const MAX_ACTIONS = 4;

/**
 * Where the parts of the match go for this room. While the room waits for players, the stage shows the invite.
 * At the end the result card shows over the board, and the action bar moves into it, so Rematch is the first
 * thing a player sees.
 *
 * @param {{ status: string }} room  RoomView
 * @returns {Readonly<{ stage: "waiting" | "board", result: boolean, actionBar: "under-stage" | "in-result" }>}
 */
export function shellLayout(room) {
  const finished = room.status === ROOM_STATUS.FINISHED;
  return Object.freeze({
    stage: room.status === ROOM_STATUS.WAITING ? "waiting" : "board",
    result: finished,
    actionBar: finished ? "in-result" : "under-stage",
  });
}

/**
 * The buttons in the action bar, in order. While a game is on, a seated player gets the game's own actions and
 * then Leave. At the end a player gets Rematch, New opponent and Leave, and a spectator a link to play the game
 * and Leave. Leave is there in every state.
 *
 * A game that returns more actions than fit fails at once, so the mistake shows in its tests and not on a phone.
 *
 * @param {any} room  RoomView
 * @param {{ actions?: (room: any) => GameAction[] }} game  the game's registry entry
 * @returns {ReadonlyArray<{ kind: "game", action: GameAction } | { kind: "rematch" | "new-opponent" | "play-game" | "leave" }>}
 */
export function actionBarItems(room, game) {
  const seated = room.you !== "";
  const leave = { kind: "leave" };
  if (room.status === ROOM_STATUS.FINISHED) {
    return Object.freeze(
      seated ? [{ kind: "rematch" }, { kind: "new-opponent" }, leave] : [{ kind: "play-game" }, leave],
    );
  }
  const own = room.status === ROOM_STATUS.PLAYING && seated && game.actions ? game.actions(room) : [];
  if (own.length >= MAX_ACTIONS) {
    throw new Error(`A game may add at most ${MAX_ACTIONS - 1} actions, Leave takes the last place`);
  }
  return Object.freeze([...own.map((action) => ({ kind: "game", action })), leave]);
}

/**
 * Sends what a game action's button stands for, through the room's own calls. The shell never decides anything
 * itself: the server checks the move or the request.
 *
 * @param {GameAction["intent"]} intent
 * @param {{ onMove: (move: object) => Promise<unknown>, onAsk: (type: string) => Promise<unknown> }} send
 */
export function sendIntent(intent, { onMove, onAsk }) {
  if (intent.type === "move") return onMove(intent.move);
  if (intent.type === "ask") return onAsk(intent.requestType);
  throw new Error(`A game action cannot send "${intent.type}"`);
}
