import { GAME_STATUS, MOVE_REJECTIONS, ROOM_STATUS } from "@classicade/shared";

/**
 * Pass and play on one phone (CC-223). The game runs here in the browser with the same pure engine the server uses,
 * called in the same order as the room does: check the move, apply it, read the outcome. Nothing is sent and nothing
 * is stored, so a local game never counts for XP, quests, streaks, achievements or boards (ADR-021). The players'
 * names live only in the session, in the page's memory.
 */

/** The two players' ids. They are local only and never reach the server. */
export const LOCAL_PLAYERS = Object.freeze(["player-1", "player-2"]);

/** The longest name a player may type, so it fits the match bar on a phone. */
export const MAX_NAME_LENGTH = 20;

/**
 * The names to play under: each trimmed, an empty one becomes "Player 1" or "Player 2". Two names that read the same
 * are refused, because every screen says whose turn it is by name.
 *
 * @param {ReadonlyArray<string>} raw  the two names as typed
 * @returns {{ ok: true, names: string[] } | { ok: false, reason: string }}
 */
export function checkNames(raw) {
  const names = raw.map((name, index) => name.trim().replace(/\s+/g, " ") || `Player ${index + 1}`);
  if (names.some((name) => name.length > MAX_NAME_LENGTH)) {
    return { ok: false, reason: `Names can be at most ${MAX_NAME_LENGTH} letters` };
  }
  if (names[0].toLowerCase() === names[1].toLowerCase()) {
    return { ok: false, reason: "Choose two different names" };
  }
  return { ok: true, names };
}

/**
 * One local game, as plain frozen data.
 *
 * @typedef {Object} LocalSession
 * @property {string} gameId
 * @property {ReadonlyArray<string>} names  in the order of LOCAL_PLAYERS
 * @property {object} options  the game's checked options
 * @property {number} number  which game this is since the names were set, 1 for the first
 * @property {unknown} state  the engine's state
 * @property {number} at  when the state last changed, in the injected clock's time
 * @property {string} uncoveredFor  the player who last uncovered the board, "" when nobody has yet
 */

const freeze = (session) => Object.freeze(session);

/**
 * The controller for one game's local sessions. It holds no state itself: every call takes a session and returns a
 * new one, so React keeps the session and a test can replay any step.
 *
 * @param {{
 *   engine: Readonly<import("@classicade/games").GameEngine<any, any, any>>,
 *   clock: { now: () => number },
 *   rng: () => number,
 * }} deps  `rng` decides who starts and the chess colours, as the engine asks
 */
export function createLocalMatch({ engine, clock, rng }) {
  if (engine === undefined || clock === undefined || rng === undefined) {
    throw new TypeError("createLocalMatch needs an engine, a clock and an rng");
  }

  const outcomeOf = (session) => engine.getOutcome(session.state);
  const finished = (session) => outcomeOf(session).status === GAME_STATUS.FINISHED;

  /** The player who holds the phone now: the first one the engine lets move, or "" once the game is over. */
  const holder = (session) => (finished(session) ? "" : engine.activePlayers(session.state)[0]);

  function begin({ names, options, number }) {
    const checkedNames = checkNames(names);
    if (!checkedNames.ok) throw new RangeError(checkedNames.reason);
    const checkedOptions = engine.validateOptions(options);
    if (!checkedOptions.ok) throw new RangeError(checkedOptions.message);
    return freeze({
      gameId: engine.id,
      names: Object.freeze(checkedNames.names),
      options: checkedOptions.value,
      number,
      state: engine.init({ players: [...LOCAL_PLAYERS], options: checkedOptions.value, rng }),
      at: clock.now(),
      uncoveredFor: "",
    });
  }

  const withState = (session, state) => freeze({ ...session, state, at: clock.now() });

  return Object.freeze({
    /**
     * A new game between two names.
     *
     * @param {{ names: ReadonlyArray<string>, options: object }} input
     * @returns {LocalSession}
     */
    start: ({ names, options }) => begin({ names, options, number: 1 }),

    /**
     * The next game with the same names and options. The engine draws who starts again.
     *
     * @param {LocalSession} session
     */
    playAgain: (session) =>
      begin({ names: session.names, options: session.options, number: session.number + 1 }),

    holder,

    /**
     * Plays a move for the player holding the phone. A refusal comes back in the engine's words, so the board can
     * say it, and the session is unchanged.
     *
     * @param {LocalSession} session
     * @param {unknown} move  what the board sends, as it would send it to the server
     * @returns {{ ok: true, session: LocalSession } | { ok: false, error: { code: string, message: string } }}
     */
    move(session, move) {
      if (finished(session)) {
        return { ok: false, error: { code: MOVE_REJECTIONS.GAME_OVER, message: "The game is over" } };
      }
      const now = clock.now();
      const playerId = holder(session);
      const checked = engine.validateMove(session.state, playerId, move, { now });
      if (!checked.ok) {
        return { ok: false, error: { code: checked.reason, message: checked.message } };
      }
      return {
        ok: true,
        session: withState(session, engine.applyMove(session.state, playerId, checked.value, { now })),
      };
    },

    /**
     * When something happens if nobody moves, such as a chess flag falling, or 0 when nothing will.
     *
     * @param {LocalSession} session
     */
    deadline: (session) => engine.deadline?.(session.state) ?? 0,

    /**
     * Applies what is due once the deadline has passed. The same session comes back when nothing is due.
     *
     * @param {LocalSession} session
     */
    expire(session) {
      const due = engine.deadline?.(session.state) ?? 0;
      if (due === 0 || clock.now() < due) return session;
      return withState(session, engine.expire(session.state, { now: clock.now() }));
    },

    /**
     * The other player said yes, in person, to a request of the player holding the phone, such as a draw offer.
     * The engine throws for a type the game does not have.
     *
     * @param {LocalSession} session
     * @param {string} type  one of the engine's request types
     */
    accept(session, type) {
      if (engine.acceptRequest === undefined) throw new TypeError(`${engine.id} has no requests`);
      const from = holder(session);
      const to = LOCAL_PLAYERS.find((player) => player !== from);
      const state = engine.acceptRequest(session.state, { type, from, to }, { now: clock.now() });
      return withState(session, state);
    },

    /**
     * Whether the board must stay covered: the game is on and the phone has not been uncovered by the player who
     * now holds it. Only games that keep a move secret use this (the registry's `passAndPlay.handOver`).
     *
     * @param {LocalSession} session
     */
    covered: (session) => !finished(session) && session.uncoveredFor !== holder(session),

    /**
     * The player holding the phone pressed to show their turn.
     *
     * @param {LocalSession} session
     */
    uncover: (session) => freeze({ ...session, uncoveredFor: holder(session) }),

    /**
     * The session as a RoomView, the shape every board already draws. The viewer is the player holding the phone,
     * so the engine hides from them what the other player chose. A finished game is shown as to a spectator, so the
     * result names the winner instead of saying "You".
     *
     * @param {LocalSession} session
     */
    roomView(session) {
      const over = finished(session);
      const you = holder(session);
      return Object.freeze({
        code: "",
        gameId: session.gameId,
        status: over ? ROOM_STATUS.FINISHED : ROOM_STATUS.PLAYING,
        hostId: "",
        players: { min: engine.players.min, max: engine.players.max },
        seats: LOCAL_PLAYERS.map((playerId, index) => ({
          playerId,
          displayName: session.names[index],
          connected: true,
          presence: "here",
          since: 0,
          graceUntil: 0,
        })),
        you,
        requests: [],
        requestsLeft: {},
        askAgainAt: {},
        serverTime: session.at,
        game: {
          matchId: "",
          view: engine.viewFor(session.state, over ? "spectator" : you),
          activePlayers: over ? [] : engine.activePlayers(session.state),
          outcome: outcomeOf(session),
          number: session.number,
          turnEndsAt: 0,
        },
      });
    },
  });
}
