// Measures how long a move takes under load, from sending it to its answer (CC-182). Run with
// `node scripts/bin/load-moves.mjs`. It starts a throwaway MongoDB and the real server in production mode in a
// child process, then plays chess and Rock Paper Scissors pairs of guests against it and prints the move times.
//
// Settings come from the environment: LOAD_PORT (default 4967), PAIRS (chess pairs and as many RPS pairs,
// default 40), DURATION_S (default 60), THINK_MS (pause before each move, default 200).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

import { Chess } from "chess.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import { io } from "socket.io-client";

import { GAME_IDS, SOCKET_EVENTS } from "../../packages/shared/src/index.js";

const PORT = Number(process.env.LOAD_PORT ?? 4967);
const BASE = `http://localhost:${PORT}`;
const PAIRS = Number(process.env.PAIRS ?? 40);
const SECONDS = Number(process.env.DURATION_S ?? 60);
const THINK_MS = Number(process.env.THINK_MS ?? 200);
const HTTPS = { "X-Forwarded-Proto": "https" };

/** The server side: runs in the child process, so the players' own work does not slow the server down. */
async function serve() {
  const { loadConfig } = await import("../../apps/server/src/config/index.js");
  const { handleShutdownSignals, startServer } = await import("../../apps/server/src/server.js");
  const { createLogger } = await import("../../apps/server/src/utils/logger.js");
  const config = loadConfig({
    NODE_ENV: "production",
    PORT: String(PORT),
    LOG_LEVEL: "warn",
    MONGO_URI: process.env.LOAD_MONGO_URI,
    SESSION_SECRET: "load-test-session-secret-not-used-anywhere-else-0123456789",
    ALLOWED_ORIGINS: BASE,
    // Production needs a built web app (`npm run build:web`), even though the players here never load it.
    WEB_DIST_DIR: fileURLToPath(new URL("../../apps/web/dist", import.meta.url)),
  });
  const logger = createLogger({ level: config.logLevel });
  // Every player connects from the same address, so the limits per address are raised out of the way.
  const open = { windowMs: 60_000, limit: 1_000_000 };
  const limits = {
    auth: { perIp: open, signupPerIp: open },
    guest: open,
    leaderboard: open,
    api: open,
  };
  const rooms = { limits: { socketsPerAddress: 1_000_000, openRoomsPerAddress: 1_000_000 } };
  const { close } = await startServer({ config, logger, limits, rooms });
  handleShutdownSignals({ close, logger });
}

async function guest() {
  const res = await fetch(`${BASE}/api/session/guest`, { method: "POST", headers: HTTPS });
  if (!res.ok) {
    throw new Error(`Guest sign in answered ${res.status}`);
  }
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      transports: ["websocket"],
      extraHeaders: { cookie, origin: BASE },
      reconnection: false,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

const times = [];
const failures = new Map();
const fail = (what) => failures.set(what, (failures.get(what) ?? 0) + 1);
let stopping = false;

function call(socket, event, payload) {
  return new Promise((resolve) => {
    socket.timeout(15_000).emit(event, payload, (err, ack) => {
      if (err || !ack?.ok) {
        // Closing the sockets at the end cuts off the answers still on their way. Those are not failures.
        if (!stopping) fail(`${event} ${err ? "timed out" : ack?.error?.code}`);
        resolve(undefined);
        return;
      }
      resolve(ack.data);
    });
  });
}

/** One player: moves whenever it is their turn, and asks for a rematch whenever a game ends. */
function player(socket, gameId) {
  let view;
  let busy = false;
  const pick = () => {
    if (gameId === GAME_IDS.CHESS) {
      const legal = new Chess(view.game.view.fen).moves({ verbose: true });
      const { from, to, promotion } = legal[Math.floor(Math.random() * legal.length)];
      return promotion ? { type: "move", from, to, promotion: "q" } : { type: "move", from, to };
    }
    return { choice: ["rock", "paper", "scissors"][Math.floor(Math.random() * 3)] };
  };
  async function act() {
    if (stopping || busy || view === undefined) return;
    busy = true;
    if (view.status === "playing" && view.game.activePlayers.includes(view.you)) {
      await sleep(THINK_MS * (0.5 + Math.random()));
      const began = performance.now();
      const answer = await call(socket, SOCKET_EVENTS.GAME_MOVE, { code: view.code, move: pick() });
      if (answer !== undefined && !stopping) times.push(performance.now() - began);
      busy = false;
      if (answer !== undefined) seen(answer);
      return;
    }
    if (
      view.status === "finished" &&
      view.rematch?.available &&
      !view.rematch.requestedBy.includes(view.you)
    ) {
      const answer = await call(socket, SOCKET_EVENTS.ROOM_REMATCH, { code: view.code });
      busy = false;
      if (answer !== undefined) seen(answer);
      return;
    }
    busy = false;
  }
  function seen(next) {
    if (view === undefined || next.serverTime >= view.serverTime) view = next;
    setImmediate(act);
  }
  socket.on(SOCKET_EVENTS.ROOM_UPDATED, seen);
  return seen;
}

async function pair(gameId, options) {
  const sockets = await Promise.all([guest(), guest()].map(async (cookie) => connect(await cookie)));
  const [host, guestPlayer] = sockets.map((socket) => player(socket, gameId));
  const room = await call(sockets[0], SOCKET_EVENTS.ROOM_CREATE, { gameId, options });
  const joined = await call(sockets[1], SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
  host(room);
  guestPlayer(joined);
  return sockets;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function waitForHealth(server) {
  for (let tries = 0; tries < 120 && server.exitCode === null; tries += 1) {
    const healthy = await fetch(`${BASE}/health`).then(
      (res) => res.ok,
      () => false,
    );
    if (healthy) return;
    await sleep(500);
  }
  throw new Error("The server did not start");
}

async function run() {
  const mongo = await MongoMemoryServer.create();
  const server = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], {
    stdio: "inherit",
    env: { ...process.env, LOAD_MONGO_URI: mongo.getUri("load") },
  });
  try {
    await waitForHealth(server);
    const sockets = (
      await Promise.all(
        Array.from({ length: PAIRS }, () => [
          pair(GAME_IDS.CHESS, { timeControl: "rapid-10+0" }),
          pair(GAME_IDS.RPS, { bestOf: 7 }),
        ]).flat(),
      )
    ).flat();
    await sleep(SECONDS * 1000);
    stopping = true;
    sockets.forEach((socket) => socket.close());
    // Lets the server finish noting the disconnects before it is stopped.
    await sleep(2000);
    const sorted = [...times].sort((a, b) => a - b);
    const ms = (value) => `${value.toFixed(1)} ms`;
    process.stdout.write(
      `${sorted.length} moves in ${SECONDS} s by ${sockets.length} players: ` +
        `p50 ${ms(percentile(sorted, 50))}, p95 ${ms(percentile(sorted, 95))}, ` +
        `p99 ${ms(percentile(sorted, 99))}, max ${ms(sorted.at(-1))}\n`,
    );
    if (failures.size > 0) {
      process.stdout.write(`failures: ${JSON.stringify(Object.fromEntries(failures))}\n`);
    }
  } finally {
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
    }
    await mongo.stop();
  }
}

await (process.argv[2] === "serve" ? serve() : run());
