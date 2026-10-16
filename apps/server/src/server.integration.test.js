import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { ENGINES, replayGame } from "@classicade/games";
import { connectDatabase } from "./persistence/database.js";
import { SESSION_COLLECTION } from "./persistence/sessionStore.js";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { testConfig } from "./testing/testConfig.js";

// Real MongoDB (in-memory), real composition root, real HTTP + WebSocket.
let mongo;
let dbCounter = 0;

beforeAll(async () => {
  mongo = await startMemoryMongo();
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

/** Reads a collection through a separate connection, as an outside observer of what was persisted. */
async function readCollection(uri, name) {
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    return await connection.db.collection(name).find().toArray();
  } finally {
    await connection.close();
  }
}

/** Makes a refused socket connection explain itself in test output (CC-079: rare refusal under full-suite load). */
const describeConnectError = (err) =>
  new Error(`socket connection refused: ${err.message} ${JSON.stringify(err.data ?? {})}`, { cause: err });

/** Polls until `probe` returns a value (the match is written in the background), failing after 5 s. */
async function eventually(probe, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const freshConfig = () => testConfig({ MONGO_URI: mongo.uri(`it-${++dbCounter}`) });

async function start(config = freshConfig()) {
  const capture = captureLogger();
  const app = await startServer({ config, logger: capture.logger });
  return { ...app, ...capture, config, url: `http://127.0.0.1:${app.port}` };
}

describe("startServer (integration)", () => {
  it("serves requests and closes the HTTP server and database cleanly", async () => {
    const app = await start();

    const res = await fetch(`${app.url}/api/health`);
    expect(await res.json()).toEqual({ status: "ok" });

    await app.close();
    expect(app.server.listening).toBe(false);
    expect(app.find("database connection closed")).toHaveLength(1);
  });

  it("stores guest sessions in MongoDB, not in memory", async () => {
    const app = await start();
    try {
      const res = await fetch(`${app.url}/api/session/guest`, { method: "POST" });
      const { identity } = await res.json();

      const sessions = await readCollection(app.config.mongoUri, SESSION_COLLECTION);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].session.identity).toEqual(identity);
    } finally {
      await app.close();
    }
  });

  it("keeps players signed in across a server restart", async () => {
    const config = freshConfig();
    const first = await start(config);
    let cookie;
    let identity;
    try {
      const created = await fetch(`${first.url}/api/session/guest`, { method: "POST" });
      cookie = created.headers.get("set-cookie").split(";")[0];
      ({ identity } = await created.json());
    } finally {
      await first.close();
    }

    const second = await start(config);
    try {
      const res = await fetch(`${second.url}/api/session`, { headers: { cookie } });

      expect(res.status).toBe(200);
      expect((await res.json()).identity).toEqual(identity);
    } finally {
      await second.close();
    }
  });

  it("authenticates sockets with the database-backed session", async () => {
    const app = await start();
    const created = await fetch(`${app.url}/api/session/guest`, { method: "POST" });
    const cookie = created.headers.get("set-cookie").split(";")[0];
    const { identity } = await created.json();

    const socket = connect(app.url, {
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
    });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", (err) => reject(describeConnectError(err)));
    });
    const ack = await socket.timeout(2_000).emitWithAck(SOCKET_EVENTS.IDENTITY_GET);
    socket.disconnect();
    await app.close();

    expect(ack).toEqual({ ok: true, data: identity });
  });

  it("refuses to start when the configured web build is missing", async () => {
    const config = testConfig({ MONGO_URI: mongo.uri("no-web"), WEB_DIST_DIR: "/nonexistent/web/dist" });

    await expect(startServer({ config, logger: captureLogger().logger })).rejects.toThrow(
      /WEB_DIST_DIR has no index.html/,
    );
  });

  it("fails to start, without leaking a connection, when the port is taken", async () => {
    const first = await start();
    const config = testConfig({ MONGO_URI: first.config.mongoUri, PORT: String(first.port) });

    try {
      await expect(startServer({ config, logger: captureLogger().logger })).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
    }
  });
});

describe("games through the real composition root (integration)", () => {
  async function connectedGuest(url) {
    const res = await fetch(`${url}/api/session/guest`, { method: "POST" });
    const cookie = res.headers.get("set-cookie").split(";")[0];
    const socket = connect(url, { transports: ["websocket"], extraHeaders: { cookie }, reconnection: false });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", (err) => reject(describeConnectError(err)));
    });
    return { socket, cookie, identity: (await res.json()).identity };
  }

  it("plays Rock Paper Scissors end to end", async () => {
    const app = await start();
    const players = [];
    try {
      const alice = await connectedGuest(app.url);
      const bob = await connectedGuest(app.url);
      players.push(alice, bob);
      const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);

      const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
        gameId: "rps",
        options: { bestOf: 1 },
      });
      await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
      await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "rock" } });
      const final = await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, {
        code: room.code,
        move: { choice: "scissors" },
      });

      expect(final.data.status).toBe("finished");
      expect(final.data.game.outcome.winners).toEqual([alice.identity.id]);

      // The match is stored in MongoDB and replays to exactly the same result.
      const summary = await eventually(async () => {
        const res = await fetch(`${app.url}/api/matches`, { headers: { cookie: alice.cookie } });
        return (await res.json()).matches[0];
      });
      const detail = await fetch(`${app.url}/api/matches/${summary.matchId}`, {
        headers: { cookie: alice.cookie },
      });
      const { match } = await detail.json();
      const rps = ENGINES.find((engine) => engine.id === "rps");
      const replayed = replayGame(rps, {
        players: match.players.map((p) => p.playerId),
        options: match.options,
        seed: match.seed,
        log: match.log,
      });

      expect(summary.outcomeForYou).toBe("win");
      expect(rps.getOutcome(replayed)).toEqual({ status: "finished", ...match.result });

      // XP is awarded from the recorded match and stored in MongoDB.
      const progress = await eventually(async () => {
        const res = await fetch(`${app.url}/api/progress`, { headers: { cookie: alice.cookie } });
        const body = (await res.json()).progress;
        return body.matchesPlayed === 1 ? body : undefined;
      });
      expect(progress).toEqual(expect.objectContaining({ xp: 30, wins: 1, level: 1 }));
    } finally {
      players.forEach((p) => p.socket.disconnect());
      await app.close();
    }
  });
});

describe("accounts through the real composition root (integration)", () => {
  it("signs up, logs in and connects a socket as the user, with production-strength hashing", async () => {
    const app = await start();
    let socket;
    try {
      const body = JSON.stringify({
        username: "Riya",
        email: "riya@example.com",
        password: "correct horse battery",
      });
      const headers = { "Content-Type": "application/json" };
      const signup = await fetch(`${app.url}/api/auth/signup`, { method: "POST", headers, body });
      const login = await fetch(`${app.url}/api/auth/login`, {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "riya@example.com", password: "correct horse battery" }),
      });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const { identity } = await login.json();

      socket = connect(app.url, { transports: ["websocket"], extraHeaders: { cookie }, reconnection: false });
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", (err) => reject(describeConnectError(err)));
      });
      const ack = await socket.timeout(2_000).emitWithAck(SOCKET_EVENTS.IDENTITY_GET);
      const [stored] = await readCollection(app.config.mongoUri, "accounts");

      expect(signup.status).toBe(201);
      expect(identity).toEqual({ kind: "user", id: `user_${stored._id.toHexString()}`, displayName: "Riya" });
      expect(ack.data).toEqual(identity);
      expect(stored.passwordHash).toMatch(/^scrypt\$32768\$8\$1\$/);
      expect(JSON.stringify(stored)).not.toContain("correct horse battery");
    } finally {
      socket?.disconnect();
      await app.close();
    }
  });
});

describe("createSessionStore (integration)", () => {
  it("creates the TTL index that expires sessions before the server takes traffic", async () => {
    const app = await start();
    try {
      const connection = await mongoose.createConnection(app.config.mongoUri).asPromise();
      const indexes = await connection.db.collection(SESSION_COLLECTION).indexes();
      await connection.close();

      expect(indexes).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: { expires: 1 }, expireAfterSeconds: 0 })]),
      );
    } finally {
      await app.close();
    }
  });
});

describe("connectDatabase", () => {
  it("wraps connection failures with the cause", async () => {
    const { logger } = captureLogger();

    const failure = await connectDatabase({
      uri: "mongodb://127.0.0.1:1/unreachable",
      logger,
      serverSelectionTimeoutMS: 300,
    }).catch((err) => err);

    expect(failure.message).toBe("Could not connect to MongoDB");
    expect(failure.cause).toBeInstanceOf(Error);
  });
});
