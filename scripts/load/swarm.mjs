// Simulated players for the load test (CC-289). Each one signs in as a new guest, connects over WebSocket only with
// its session cookie as the web app does, and plays whole games: friends in pairs through a room code, or one player
// against a computer character. They think before each move, rematch or open a new room, and keep playing until
// the swarm stops.
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

import { io } from "socket.io-client";

import {
  REQUEST_ANSWERS,
  ROOM_REQUEST_TYPES,
  ROOM_STATUS,
  SOCKET_EVENTS,
} from "../../packages/shared/src/index.js";
import { chooseMove, draw, pickPlan, roomOptions } from "./model.mjs";
import { MOVE } from "./stats.mjs";

// The harness talks to the server as Render's proxy would, so the production session cookie (Secure) is set.
const HTTPS = Object.freeze({ "X-Forwarded-Proto": "https" });

/**
 * @typedef {Object} SwarmDeps
 * @property {string} base                 the server, such as `http://127.0.0.1:4977`
 * @property {string} [origin]             the page the browser would be on, the server itself unless a test says
 * @property {ReturnType<typeof import("./stats.mjs").createRecorder>} recorder
 * @property {import("../../packages/games/src/rng.js").Rng} rng
 * @property {import("./model.mjs").PlayerModel} model
 * @property {number} [waitMs]             how long a player waits for the server before it counts as stuck
 * @property {(ms: number) => Promise<unknown>} [pause]   waits, real time unless a test shortens it
 */

/**
 * Starts no one at first. `grow` adds players until there are that many, and `stop` ends every game loop and
 * closes every socket.
 *
 * @param {SwarmDeps} deps
 * @returns {{ grow: (target: number, spreadMs: number) => Promise<void>, players: () => number, playing: () => number, stop: () => Promise<void> }}
 *   `players` counts open sockets, `playing` the players whose games are still going. A player whose games ended
 *   (a refusal, no answer) is counted as a failure, closed and no longer playing
 */
export function createSwarm({ base, origin = base, recorder, rng, model, waitMs = 30_000, pause = sleep }) {
  let stopping = false;
  let planned = 0;
  let playing = 0;
  const sockets = new Set();
  const loops = new Set();

  // Ends one player's games: the server refused or did not answer (already counted), or the swarm is stopping.
  const ENDED = new Error("the player's games ended");
  const need = (value) => {
    if (value === undefined) throw ENDED;
    return value;
  };

  /** Times one call, records how it went, and answers its data, or undefined when it failed. */
  async function call(socket, event, payload, name = event) {
    const began = performance.now();
    try {
      const ack = await socket.timeout(waitMs).emitWithAck(event, payload);
      recorder.time(name, performance.now() - began);
      if (!ack.ok) {
        recorder.fail(`${event} ${ack.error.code}`);
        return undefined;
      }
      return ack.data;
    } catch {
      // Closing the sockets at the end cuts off the answers still on their way. Those are not failures.
      if (!stopping) recorder.fail(`${event} timed out`);
      return undefined;
    }
  }

  async function signIn() {
    const began = performance.now();
    const res = await fetch(`${base}/api/session/guest`, { method: "POST", headers: HTTPS });
    recorder.time("guest sign-in", performance.now() - began);
    if (!res.ok) {
      throw new Error(`guest sign-in ${res.status}`);
    }
    return res.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }

  function connect(cookie) {
    const began = performance.now();
    return new Promise((resolve, reject) => {
      const socket = io(base, {
        transports: ["websocket"],
        extraHeaders: { cookie, origin, ...HTTPS },
        reconnection: false,
      });
      socket.once("connect", () => {
        recorder.time("socket connect", performance.now() - began);
        resolve(socket);
      });
      socket.once("connect_error", (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  /**
   * A signed-in, connected player who keeps the newest view of each room. Views arrive both as answers and as
   * `room:updated`, and an update can overtake an answer, so the higher revision wins. A computer may even move
   * before the answer that opened its room arrives, so updates are kept for every room, not only the current one.
   */
  async function arrive(owned) {
    const socket = await connect(await signIn());
    // A player who arrives after the swarm stopped goes again at once, so no socket outlives the run, and its
    // games end before its first call (CC-309).
    if (stopping) {
      socket.close();
      throw ENDED;
    }
    sockets.add(socket);
    owned.push(socket);
    socket.on("disconnect", (reason) => {
      sockets.delete(socket);
      player.gone = true;
      player.wake();
      if (!stopping && reason !== "io client disconnect") recorder.fail(`disconnected ${reason}`);
    });
    const views = new Map();
    const player = {
      socket,
      code: "",
      // Set when the socket closes, so a game of a player who left ends instead of waiting for nothing.
      gone: false,
      wake: () => {},
      get view() {
        return views.get(player.code);
      },
      see(next) {
        const known = views.get(next.code);
        if (known === undefined || next.revision >= known.revision) views.set(next.code, next);
        player.wake();
      },
      enter(room) {
        player.code = room.code;
        // Rooms left behind are forgotten, so a long run does not pile up old views.
        [...views.keys()].filter((code) => code !== room.code).forEach((code) => views.delete(code));
        player.see(room);
      },
    };
    socket.on(SOCKET_EVENTS.ROOM_UPDATED, (view) => player.see(view));
    return player;
  }

  /** Waits until `ready` holds for the player's newest view, and ends the player's games when nothing comes. */
  async function until(player, ready) {
    const deadline = performance.now() + waitMs;
    for (;;) {
      if (stopping || player.gone) throw ENDED;
      if (ready(player.view)) return;
      const left = deadline - performance.now();
      if (left <= 0) {
        recorder.fail("stuck waiting for the server");
        throw ENDED;
      }
      const woken = new Promise((resolve) => {
        player.wake = resolve;
      });
      await Promise.race([woken, sleep(Math.min(left, 1_000))]);
    }
  }

  /** A pause drawn from a span, after which a stopping swarm ends the player's games. */
  async function rest(span) {
    await pause(draw(rng, span));
    if (stopping) throw ENDED;
  }

  const myTurn = (view) => view.status === ROOM_STATUS.PLAYING && view.game.activePlayers.includes(view.you);
  const over = (view) => view.status !== ROOM_STATUS.PLAYING;

  /**
   * Plays game `number` of the player's room to its end, thinking before each move. It starts once the player has
   * seen that game begin, because the view in hand may still be the waiting room or the game before.
   */
  async function playGame(player, { gameId, computer }, number) {
    let ownMoves = 0;
    const resignAt = draw(rng, model.chessOwnMoves);
    await until(player, (view) => view.game?.number === number);
    for (;;) {
      await until(player, (view) => over(view) || myTurn(view));
      if (over(player.view)) {
        recorder.count(`games ${gameId} ${computer ? "computer" : "people"}`);
        return;
      }
      await rest(model.thinkMs[gameId]);
      // A chess clock may have run out while the player thought. Then the game is over and there is no move.
      if (!myTurn(player.view)) continue;
      const { code, game } = player.view;
      ownMoves += 1;
      const sent = performance.now();
      const move = chooseMove({ gameId, game, rng, resign: ownMoves > resignAt });
      player.see(
        need(await call(player.socket, SOCKET_EVENTS.GAME_MOVE, { code, move }, `${MOVE} ${gameId}`)),
      );
      if (computer && !over(player.view) && !myTurn(player.view)) {
        // The computer replies after a human-like pause (400 to 900 ms) plus its thinking in the server's queue.
        await until(player, (view) => over(view) || myTurn(view));
        recorder.time(`computer reply ${gameId}`, performance.now() - sent);
      }
    }
  }

  /** Friends: one opens a room, the other joins with its code, and they play until the swarm stops. */
  async function pairLoop(plan, owned) {
    const { gameId } = plan;
    const [host, guest] = await Promise.all([arrive(owned), arrive(owned)]);
    for (;;) {
      const options = roomOptions(gameId, model);
      const name = `room:create ${gameId}`;
      host.enter(need(await call(host.socket, SOCKET_EVENTS.ROOM_CREATE, { gameId, options }, name)));
      const { code } = host.view;
      guest.enter(need(await call(guest.socket, SOCKET_EVENTS.ROOM_JOIN, { code })));
      for (let number = 1; ; number += 1) {
        await Promise.all([playGame(host, plan, number), playGame(guest, plan, number)]);
        await rest(model.resultMs);
        if (rng() >= model.rematchShare) break;
        const type = ROOM_REQUEST_TYPES.REMATCH;
        host.see(need(await call(host.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type })));
        const answer = REQUEST_ANSWERS.ACCEPT;
        guest.see(need(await call(guest.socket, SOCKET_EVENTS.ROOM_ANSWER, { code, type, answer })));
      }
      need(await call(guest.socket, SOCKET_EVENTS.ROOM_LEAVE, { code }));
      need(await call(host.socket, SOCKET_EVENTS.ROOM_LEAVE, { code }));
    }
  }

  /** One player against a computer character, rematching it or starting a new game. */
  async function computerLoop(plan, owned) {
    const { gameId, level } = plan;
    const player = await arrive(owned);
    for (;;) {
      const options = roomOptions(gameId, model);
      const name = `room:play-computer ${gameId}`;
      const payload = { gameId, level, options };
      player.enter(need(await call(player.socket, SOCKET_EVENTS.ROOM_PLAY_COMPUTER, payload, name)));
      const { code } = player.view;
      for (let number = 1; ; number += 1) {
        await playGame(player, plan, number);
        await rest(model.resultMs);
        if (rng() >= model.rematchShare) break;
        // The computer accepts after its pause, and the next game starts.
        const type = ROOM_REQUEST_TYPES.REMATCH;
        player.see(need(await call(player.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type })));
      }
      need(await call(player.socket, SOCKET_EVENTS.ROOM_LEAVE, { code }));
    }
  }

  function start(delayMs) {
    const plan = pickPlan(rng, model);
    const size = plan.computer ? 1 : 2;
    planned += size;
    const owned = [];
    const loop = (async () => {
      await pause(delayMs);
      if (stopping) return;
      playing += size;
      try {
        await (plan.computer ? computerLoop(plan, owned) : pairLoop(plan, owned));
      } finally {
        // A player whose games ended leaves, so the counts show who is really still playing.
        playing -= size;
        owned.forEach((socket) => socket.close());
      }
    })().catch((err) => {
      if (err !== ENDED && !stopping) recorder.fail(`player ${err.message}`);
    });
    loops.add(loop);
    loop.finally(() => loops.delete(loop));
  }

  return {
    async grow(target, spreadMs) {
      while (planned < target) {
        start(rng() * spreadMs);
      }
    },
    players: () => sockets.size,
    playing: () => playing,
    async stop() {
      stopping = true;
      sockets.forEach((socket) => socket.close());
      await Promise.all([...loops]);
    },
  };
}
