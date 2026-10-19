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
 * @returns {{ grow: (target: number, spreadMs: number) => Promise<void>, players: () => number, stop: () => Promise<void> }}
 */
export function createSwarm({ base, origin = base, recorder, rng, model, waitMs = 30_000, pause = sleep }) {
  let stopping = false;
  let planned = 0;
  const sockets = new Set();
  const loops = new Set();

  /** Times one call, records how it went, and answers its data, or undefined when it failed. */
  async function call(socket, event, payload, name = event) {
    const began = performance.now();
    try {
      const ack = await socket.timeout(waitMs).emitWithAck(event, payload);
      if (stopping) return undefined;
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
  async function arrive() {
    const socket = await connect(await signIn());
    sockets.add(socket);
    socket.on("disconnect", (reason) => {
      sockets.delete(socket);
      if (!stopping && reason !== "io client disconnect") recorder.fail(`disconnected ${reason}`);
    });
    const views = new Map();
    const player = {
      socket,
      code: "",
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

  /** Waits until `ready` holds for the player's newest view. Answers false when the swarm stops or nothing comes. */
  async function until(player, ready) {
    const deadline = performance.now() + waitMs;
    while (!stopping && !ready(player.view)) {
      const left = deadline - performance.now();
      if (left <= 0) {
        recorder.fail("stuck waiting for the server");
        return false;
      }
      const woken = new Promise((resolve) => {
        player.wake = resolve;
      });
      await Promise.race([woken, sleep(Math.min(left, 1_000))]);
    }
    return !stopping;
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
    if (!(await until(player, (view) => view.game?.number === number))) return false;
    while (await until(player, (view) => over(view) || myTurn(view))) {
      if (over(player.view)) {
        recorder.count(`games ${gameId} ${computer ? "computer" : "people"}`);
        return true;
      }
      await pause(draw(rng, model.thinkMs[gameId]));
      if (stopping) return false;
      // A chess clock may have run out while the player thought. Then the game is over and there is no move.
      if (!myTurn(player.view)) continue;
      const { code, game } = player.view;
      ownMoves += 1;
      const sent = performance.now();
      const answer = await call(
        player.socket,
        SOCKET_EVENTS.GAME_MOVE,
        { code, move: chooseMove({ gameId, game, rng, resign: ownMoves > resignAt }) },
        `${MOVE} ${gameId}`,
      );
      if (answer === undefined) return false;
      player.see(answer);
      if (computer && !over(player.view) && !myTurn(player.view)) {
        // The computer replies after a human-like pause (400 to 900 ms) plus its thinking in the server's queue.
        if (!(await until(player, (view) => over(view) || myTurn(view)))) return false;
        recorder.time(`computer reply ${gameId}`, performance.now() - sent);
      }
    }
    return false;
  }

  /** Friends: one opens a room, the other joins with its code, and they play until the swarm stops. */
  async function pairLoop(plan) {
    const [host, guest] = await Promise.all([arrive(), arrive()]);
    while (!stopping) {
      const created = await call(
        host.socket,
        SOCKET_EVENTS.ROOM_CREATE,
        { gameId: plan.gameId, options: roomOptions(plan.gameId, model) },
        `room:create ${plan.gameId}`,
      );
      if (created === undefined) return;
      host.enter(created);
      const joined = await call(guest.socket, SOCKET_EVENTS.ROOM_JOIN, { code: created.code });
      if (joined === undefined) return;
      guest.enter(joined);
      for (let number = 1; ; number += 1) {
        const played = await Promise.all([playGame(host, plan, number), playGame(guest, plan, number)]);
        if (!played.every(Boolean)) return;
        await pause(draw(rng, model.resultMs));
        if (stopping) return;
        if (rng() >= model.rematchShare) break;
        const { code } = host.view;
        const asked = await call(host.socket, SOCKET_EVENTS.ROOM_REQUEST, {
          code,
          type: ROOM_REQUEST_TYPES.REMATCH,
        });
        if (asked === undefined) return;
        host.see(asked);
        const accepted = await call(guest.socket, SOCKET_EVENTS.ROOM_ANSWER, {
          code,
          type: ROOM_REQUEST_TYPES.REMATCH,
          answer: REQUEST_ANSWERS.ACCEPT,
        });
        if (accepted === undefined) return;
        guest.see(accepted);
      }
      const { code } = host.view;
      if ((await call(guest.socket, SOCKET_EVENTS.ROOM_LEAVE, { code })) === undefined) return;
      if ((await call(host.socket, SOCKET_EVENTS.ROOM_LEAVE, { code })) === undefined) return;
    }
  }

  /** One player against a computer character, rematching it or starting a new game. */
  async function computerLoop(plan) {
    const player = await arrive();
    while (!stopping) {
      const started = await call(
        player.socket,
        SOCKET_EVENTS.ROOM_PLAY_COMPUTER,
        { gameId: plan.gameId, level: plan.level, options: roomOptions(plan.gameId, model) },
        `room:play-computer ${plan.gameId}`,
      );
      if (started === undefined) return;
      player.enter(started);
      for (let number = 1; ; number += 1) {
        if (!(await playGame(player, plan, number))) return;
        await pause(draw(rng, model.resultMs));
        if (stopping) return;
        if (rng() >= model.rematchShare) break;
        const asked = await call(player.socket, SOCKET_EVENTS.ROOM_REQUEST, {
          code: player.view.code,
          type: ROOM_REQUEST_TYPES.REMATCH,
        });
        if (asked === undefined) return;
        // The computer accepts after its pause, and the next game starts.
        player.see(asked);
      }
      if ((await call(player.socket, SOCKET_EVENTS.ROOM_LEAVE, { code: player.view.code })) === undefined)
        return;
    }
  }

  function start(delayMs) {
    const plan = pickPlan(rng, model);
    planned += plan.computer ? 1 : 2;
    const loop = (async () => {
      await pause(delayMs);
      if (stopping) return;
      await (plan.computer ? computerLoop(plan) : pairLoop(plan));
    })().catch((err) => {
      if (!stopping) recorder.fail(`player ${err.message}`);
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
    async stop() {
      stopping = true;
      sockets.forEach((socket) => socket.close());
      await Promise.all([...loops]);
    },
  };
}
