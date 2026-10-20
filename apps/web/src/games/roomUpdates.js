import { REQUEST_ANSWERS, REQUEST_STATES, ROOM_REQUEST_TYPES, ROOM_STATUS } from "@classicade/shared";
import { SOUNDS } from "../lib/sound/sounds.js";
import { outcomeMoment } from "./outcomeMoment.js";
import { gameView } from "./registry.js";
import { gameNumber, isYourTurn, nameOf } from "./roomView.js";

/**
 * What a room update means for the person watching it: which sounds to play (CC-103), which questions are waiting
 * for an answer, and how the questions they were part of ended (CC-104, CC-159). The requests themselves come from
 * the server (the RoomView's `requests`), so a reload shows the same ones. How a request ended is worked out by
 * comparing the view before and after an update, so it is news only once. Each game adds the words for its own
 * kinds of request through the client game registry, and nothing here names a game.
 */

/**
 * What pressing a button does: send a game move, ask for something, or answer a request.
 *
 * @typedef {{ type: "move", move: object }
 *   | { type: "ask", requestType: string }
 *   | { type: "answer", requestType: string, answer: string }} RoomAction
 *
 * @typedef {Object} RequestTexts      the words for one kind of request
 * @property {string} title            the heading the player asked sees
 * @property {string} waitingTitle     the name of what the asker sees while they wait
 * @property {(name: string) => string} question   the question, given the asker's name
 * @property {(name: string) => string} waiting    what the asker sees, given the name of the player asked
 * @property {(name: string) => string} declined   what the asker hears when the other says no
 * @property {(name: string) => string} withdrawn  what the player asked hears when the asker takes it back
 * @property {(name: string) => string} accepted   what the asker hears when the other says yes
 * @property {(game: string) => string} site       the question on another page, such as "wants a rematch at
 *   Chess", after the asker's name
 *
 * @typedef {Object} RoomRequest       an open request, with its words and what its buttons do
 * @property {string} key              the same while the request stands, so it alerts only once
 * @property {string} type
 * @property {string} from             the player id who asked
 * @property {string} to               the player id who was asked
 * @property {number} createdAt        server time
 * @property {number} expiresAt        server time
 * @property {RequestTexts} texts
 * @property {RoomAction} accept
 * @property {RoomAction} decline
 * @property {RoomAction} cancel
 *
 * @typedef {Object} RequestAnswer     how a request the viewer was part of ended
 * @property {string} key
 * @property {string} type
 * @property {string} state            a REQUEST_STATES value
 * @property {boolean} asked           whether the viewer was the one who asked
 * @property {string} otherId          the other player's id
 * @property {string} message          what to tell the viewer
 */

/** The words of a rematch request, the one kind every room has. */
export const REMATCH_TEXTS = Object.freeze({
  title: "Rematch?",
  waitingTitle: "Rematch asked",
  question: (name) => `${name} wants a rematch.`,
  waiting: (name) => `Waiting for ${name} to answer your rematch request`,
  declined: (name) => `${name} declined the rematch`,
  withdrawn: (name) => `${name} took back the rematch request`,
  accepted: (name) => `${name} accepted. Starting the next game`,
  site: (game) => `wants a rematch at ${game}`,
});

/** Words for a kind of request a game added but this version of the web app does not know yet. */
const UNKNOWN_TEXTS = Object.freeze({
  title: "Request",
  waitingTitle: "Request sent",
  question: (name) => `${name} is asking you something.`,
  waiting: (name) => `Waiting for ${name} to answer`,
  declined: (name) => `${name} said no`,
  withdrawn: (name) => `${name} took the request back`,
  accepted: (name) => `${name} said yes`,
  site: (game) => `is asking you something at ${game}`,
});

/**
 * The words for one kind of request in one game.
 *
 * @param {string} gameId
 * @param {string} type
 * @returns {RequestTexts}
 */
export function textsFor(gameId, type) {
  if (type === ROOM_REQUEST_TYPES.REMATCH) return REMATCH_TEXTS;
  // The type comes from the other player: only the game's own kinds count, never what an object inherits.
  const texts = gameView(gameId).requestTexts;
  return texts !== undefined && Object.hasOwn(texts, type) ? texts[type] : UNKNOWN_TEXTS;
}

const NONE = Object.freeze([]);
const requestsIn = (room) => room.requests ?? NONE;
const keyOf = (request) => `${request.type}:${request.from}:${request.createdAt}`;
const answer = (requestType, value) => ({ type: "answer", requestType, answer: value });

/**
 * Every request open in the room, with its words and what its buttons do.
 *
 * @param {any} room  RoomView
 * @returns {RoomRequest[]}
 */
export function roomRequests(room) {
  return requestsIn(room)
    .filter((request) => request.state === REQUEST_STATES.OPEN)
    .map((request) => ({
      key: keyOf(request),
      type: request.type,
      from: request.from,
      to: request.to,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      texts: textsFor(room.gameId, request.type),
      accept: answer(request.type, REQUEST_ANSWERS.ACCEPT),
      decline: answer(request.type, REQUEST_ANSWERS.DECLINE),
      cancel: answer(request.type, REQUEST_ANSWERS.WITHDRAW),
    }));
}

/**
 * The requests the viewer is asked to answer. Spectators answer nothing.
 *
 * @param {any} room  RoomView
 */
export const incomingRequests = (room) =>
  room.you === "" ? [] : roomRequests(room).filter((request) => request.to === room.you);

/**
 * The requests the viewer asked that wait for an answer.
 *
 * @param {any} room  RoomView
 */
export const outgoingRequests = (room) =>
  room.you === "" ? [] : roomRequests(room).filter((request) => request.from === room.you);

/** What the viewer is told about how one request they were part of ended. */
function answerMessage(room, request) {
  const texts = textsFor(room.gameId, request.type);
  const asked = request.from === room.you;
  const other = nameOf(room, asked ? request.to : request.from);
  switch (request.state) {
    case REQUEST_STATES.ACCEPTED:
      return asked ? texts.accepted(other) : "You accepted";
    case REQUEST_STATES.DECLINED:
      return asked ? texts.declined(other) : "You said no";
    case REQUEST_STATES.WITHDRAWN:
      return asked ? "You took the request back" : texts.withdrawn(other);
    default:
      return asked ? `No answer from ${other}` : `The request from ${other} ran out of time`;
  }
}

/**
 * How the requests the viewer was part of ended in this update: accepted, declined, withdrawn or expired (CC-160).
 * Both players are told, each in their own words. A request that simply went away without an answer (a draw offer
 * when the game ended another way) is not news.
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @returns {RequestAnswer[]}
 */
export function requestAnswers(previous, next) {
  if (previous.code !== next.code || next.you === "") {
    return [];
  }
  const wasOpen = new Set(
    requestsIn(previous)
      .filter((request) => request.state === REQUEST_STATES.OPEN)
      .map(keyOf),
  );
  return requestsIn(next)
    .filter((request) => request.state !== REQUEST_STATES.OPEN && wasOpen.has(keyOf(request)))
    .filter((request) => request.from === next.you || request.to === next.you)
    .map((request) => ({
      key: keyOf(request),
      type: request.type,
      state: request.state,
      asked: request.from === next.you,
      otherId: request.from === next.you ? request.to : request.from,
      message: answerMessage(next, request),
    }));
}

/**
 * Who just left a finished game, by name. The server keeps the name, because the seat is already gone (CC-162).
 */
function leaverName(previous, next) {
  if (next.rematch.leftName) {
    return next.rematch.leftName;
  }
  const gone = previous.seats.find((seat) => !next.seats.some((s) => s.playerId === seat.playerId));
  return gone?.displayName ?? "Your opponent";
}

/**
 * Short messages for the viewer that are not about a request: the opponent leaving the finished game (New
 * opponent, Leave room, or staying away too long), so they never wait for a rematch that cannot come (CC-162,
 * CC-207).
 *
 * @param {any} previous  RoomView before the update
 * @param {any} next      RoomView after it
 * @returns {string[]}
 */
export function roomNotices(previous, next) {
  if (previous.code !== next.code || next.you === "" || next.status !== ROOM_STATUS.FINISHED) {
    return [];
  }
  if (previous.rematch === undefined || next.rematch === undefined) {
    return [];
  }
  return previous.rematch.available && !next.rematch.available
    ? [`${leaverName(previous, next)} left the room`]
    : [];
}

/** Whether two views show the same game of the room (a rematch is a new game in the same room). */
const sameGame = (previous, next) =>
  previous.code === next.code &&
  previous.game !== undefined &&
  next.game !== undefined &&
  gameNumber(previous) === gameNumber(next);

/**
 * The viewer's result sound for a game that just ended, from its outcome moment (CC-163): a win, a quiet win, the
 * soft loss, a draw or the void note of an aborted game. Spectators get none: it is not their win or loss.
 */
function resultSound(room) {
  const { sound } = outcomeMoment(room);
  return sound === "" ? NONE : [sound];
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
      ? (gameView(next.gameId).soundsFor ?? (() => NONE))(previous, next, next.you)
      : NONE;
  const seen = new Set(incomingRequests(previous).map((request) => request.key));
  const asked = incomingRequests(next).some((request) => !seen.has(request.key));
  // The asker hears the answer. Taking back your own request is not news to you.
  const answered =
    requestAnswers(previous, next).some((each) => each.asked && each.state !== REQUEST_STATES.WITHDRAWN) ||
    roomNotices(previous, next).length > 0;
  const turn = hidden && !started && !isYourTurn(previous) && isYourTurn(next);
  return [
    ...forGame,
    ...(started ? [SOUNDS.GAME_START] : NONE),
    ...(ended ? resultSound(next) : NONE),
    ...(asked || answered ? [SOUNDS.NOTIFY] : NONE),
    ...(turn ? [SOUNDS.YOUR_TURN] : NONE),
  ];
}
