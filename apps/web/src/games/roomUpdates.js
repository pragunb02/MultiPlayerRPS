import { ROOM_STATUS } from "@classicade/shared";
import { SOUNDS } from "../lib/sound/sounds.js";
import { gameView } from "./registry.js";
import { gameNumber, isYourTurn, nameOf } from "./roomView.js";

/**
 * What a room update means for the person watching it: which sounds to play (CC-103), which questions are waiting
 * for an answer, and which answers to tell them about (CC-104). Everything here is worked out from two RoomViews,
 * the one before an update and the one after, so it is the same after a reload and needs no extra server events.
 * Each game adds its own part through the client game registry, and nothing here names a game.
 */

/**
 * Something one player asks the other and waits for an answer to: a draw offer, a rematch.
 *
 * @typedef {{ type: "move", move: object } | { type: "rematch" } | { type: "decline-rematch" }} RoomAction
 *   what pressing a button does: send a game move, ask for (or take back) a rematch, or say no to one
 *
 * @typedef {Object} RoomRequest
 * @property {string} key            stays the same while the request stands, so it alerts only once
 * @property {string} from           the player id who asked
 * @property {string} title          the heading the other player sees
 * @property {(name: string) => string} question   the question, given the asker's name
 * @property {string} waitingTitle   the heading the asker sees while waiting
 * @property {boolean} showWaiting   whether the room page shows the asker a waiting card with Cancel (false when
 *   the game's own panel already does)
 * @property {RoomAction} accept
 * @property {RoomAction} decline
 * @property {RoomAction} cancel
 */

const NONE = Object.freeze([]);
const none = () => NONE;
const declinedBy = (room) => room.rematch?.declinedBy ?? "";

/**
 * A rematch someone asked for, while it can still happen (CC-037). Once you asked as well the new game starts, so
 * you only ever see either your own request or theirs.
 *
 * @param {any} room  RoomView
 * @returns {RoomRequest[]}
 */
function rematchRequests(room) {
  if (room.status !== ROOM_STATUS.FINISHED || room.rematch === undefined || !room.rematch.available) {
    return [];
  }
  const { requestedBy } = room.rematch;
  const asking = requestedBy.includes(room.you) ? [room.you] : requestedBy;
  return asking.map((from) => ({
    key: `rematch:${from}`,
    from,
    title: "Rematch?",
    question: (name) => `${name} wants a rematch.`,
    waitingTitle: "Rematch asked",
    showWaiting: false,
    accept: { type: "rematch" },
    decline: { type: "decline-rematch" },
    cancel: { type: "rematch" },
  }));
}

/**
 * Every request standing in the room: the rematch, then whatever the game adds (a chess draw offer).
 *
 * @param {any} room  RoomView
 * @returns {RoomRequest[]}
 */
export function roomRequests(room) {
  const forGame = room.game === undefined ? NONE : (gameView(room.gameId).requests ?? none)(room);
  return [...rematchRequests(room), ...forGame];
}

/**
 * The requests the viewer is asked to answer. Spectators answer nothing.
 *
 * @param {any} room  RoomView
 * @returns {RoomRequest[]}
 */
export function incomingRequests(room) {
  return room.you === "" ? [] : roomRequests(room).filter((request) => request.from !== room.you);
}

/**
 * What the other side did with a rematch request: the asker hears that it was declined, the one asked hears that
 * it was taken back. Nobody is told about their own answer, and a player leaving is shown by the rematch panel.
 */
function rematchNotices(previous, next) {
  const you = next.you;
  if (you === "" || next.status !== ROOM_STATUS.FINISHED || previous.rematch === undefined) {
    return [];
  }
  if (next.rematch === undefined || !next.rematch.available) {
    return [];
  }
  const by = declinedBy(next);
  if (by !== "" && by !== you && declinedBy(previous) !== by) {
    return [`${nameOf(next, by)} declined the rematch`];
  }
  if (by !== "") {
    return [];
  }
  return previous.rematch.requestedBy
    .filter((id) => id !== you && !next.rematch.requestedBy.includes(id))
    .map((id) => `${nameOf(next, id)} took back the rematch request`);
}

/** Whether two views show the same game of the room (a rematch is a new game in the same room). */
const sameGame = (previous, next) =>
  previous.code === next.code &&
  previous.game !== undefined &&
  next.game !== undefined &&
  gameNumber(previous) === gameNumber(next);

/**
 * Short messages for the viewer about answers to requests (CC-104), for example "Bob declined your draw offer".
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @returns {string[]}
 */
export function roomNotices(previous, next) {
  if (previous.code !== next.code) {
    return [];
  }
  const forGame = sameGame(previous, next)
    ? (gameView(next.gameId).notices ?? none)(previous, next, next.you)
    : NONE;
  return [...rematchNotices(previous, next), ...forGame];
}

/** The viewer's result sound for a game that just ended. Spectators get none: it is not their win or loss. */
function resultSound(room) {
  const { outcome } = room.game;
  if (room.you === "" || !room.seats.some((seat) => seat.playerId === room.you)) {
    return NONE;
  }
  if (outcome.result === "draw") {
    return [SOUNDS.DRAW];
  }
  return [outcome.winners.includes(room.you) ? SOUNDS.WIN : SOUNDS.LOSS];
}

/**
 * The sounds one room update makes (CC-103). In order: the game's own sounds (a move, a capture, a mark), then
 * the start or the result of a game, then a chime when someone asks you something or answers you, then "your
 * turn" when it became your move while this tab is in the background. Opening or reloading a room makes no sound:
 * only changes do.
 *
 * @param {{ previous: any, next: any, hidden: boolean }} input  `previous` is undefined for the first view, and
 *   `hidden` says whether the tab is in the background
 * @returns {string[]} ids from SOUNDS
 */
export function roomSounds({ previous, next, hidden }) {
  if (previous === undefined || previous.code !== next.code || next.game === undefined) {
    return [];
  }
  const started =
    next.status === ROOM_STATUS.PLAYING &&
    (previous.status !== ROOM_STATUS.PLAYING || gameNumber(previous) !== gameNumber(next));
  const ended = previous.status === ROOM_STATUS.PLAYING && next.status === ROOM_STATUS.FINISHED;
  const forGame =
    !started && sameGame(previous, next)
      ? (gameView(next.gameId).soundsFor ?? none)(previous, next, next.you)
      : NONE;
  const seen = new Set(incomingRequests(previous).map((request) => request.key));
  const asked = incomingRequests(next).some((request) => !seen.has(request.key));
  const answered = roomNotices(previous, next).length > 0;
  const turn = hidden && !started && !isYourTurn(previous) && isYourTurn(next);
  return [
    ...forGame,
    ...(started ? [SOUNDS.GAME_START] : NONE),
    ...(ended ? resultSound(next) : NONE),
    ...(asked || answered ? [SOUNDS.NOTIFY] : NONE),
    ...(turn ? [SOUNDS.YOUR_TURN] : NONE),
  ];
}
