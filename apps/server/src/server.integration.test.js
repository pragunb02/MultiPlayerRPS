import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { ENGINES, replayGame } from "@classicade/games";
import { connectDatabase } from "./persistence/database.js";
import { createSessionStore, SESSION_COLLECTION } from "./persistence/sessionStore.js";
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

async function start(config = freshConfig(), { now } = {}) {
  const capture = captureLogger();
  // A failing test shows what the server saw (refused sockets, session lookups) — rare flakes explain themselves.
  onTestFailed(() => {
    process.stderr.write(`\n--- server log (${config.mongoUri.split("/").pop()}) ---\n`);
    capture.entries.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`));
  });
  const app = await startServer({ config, logger: capture.logger, ...(now === undefined ? {} : { now }) });
  return { ...app, ...capture, config, url: `http://127.0.0.1:${app.port}` };
}

describe("startServer (integration)", () => {
  it("serves requests and closes the HTTP server and database cleanly", async () => {
    const app = await start();

    const res = await fetch(`${app.url}/health`);
    expect(await res.json()).toEqual({ status: "ok", database: "up" });

    await app.close();
    expect(app.server.listening).toBe(false);
    expect(app.find("database connection closed")).toHaveLength(1);
  });

  it("listens on loopback only by default and says where in the startup log (CC-287)", async () => {
    const app = await start();

    try {
      expect(app.server.address()).toEqual(expect.objectContaining({ address: "127.0.0.1", family: "IPv4" }));
      expect(app.host).toBe("127.0.0.1");
      expect(app.find("server listening")).toEqual([
        expect.objectContaining({ host: "127.0.0.1", port: app.port, env: "test" }),
      ]);
    } finally {
      await app.close();
    }
  });

  it("listens on the configured HOST (CC-287)", async () => {
    const app = await start(testConfig({ MONGO_URI: mongo.uri(`it-${++dbCounter}`), HOST: "::1" }));

    try {
      expect(app.server.address()).toEqual(expect.objectContaining({ address: "::1", family: "IPv6" }));
      expect(app.find("server listening")).toEqual([
        expect.objectContaining({ host: "::1", port: app.port }),
      ]);
      const res = await fetch(`http://[::1]:${app.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await app.close();
    }
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

  it("refuses to start, and closes the database, when the stored rooms cannot be settled", async () => {
    const config = freshConfig();
    const seed = await mongoose.createConnection(config.mongoUri).asPromise();
    // A room of a game this server does not have (say, one that was removed) cannot be brought up to date.
    await seed.db.collection("rooms").insertOne({
      code: "OLD222",
      gameId: "no-such-game",
      status: "waiting",
      seats: [{ playerId: "guest_a", displayName: "Alice", connected: true }],
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      version: 1,
    });
    await seed.close();

    await expect(startServer({ config, logger: captureLogger().logger })).rejects.toThrow(/no-such-game/);
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
      // Views name players by seat id (CC-253): Alice's is the `you` of her own view.
      expect(final.data.game.outcome.winners).toEqual([room.you]);
      expect(JSON.stringify(final.data)).not.toContain(alice.identity.id);

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
      expect(progress).toEqual(expect.objectContaining({ wins: 1 }));
    } finally {
      players.forEach((p) => p.socket.disconnect());
      await app.close();
    }
  });

  it("tells the player still there who left a finished game, and keeps it in MongoDB (CC-162)", async () => {
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
      await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "scissors" } });
      await send(alice.socket, SOCKET_EVENTS.ROOM_REQUEST, { code: room.code, type: "rematch" });

      // Bob picks a new opponent instead: he leaves the finished room.
      const aliceHears = new Promise((resolve) => alice.socket.once(SOCKET_EVENTS.ROOM_UPDATED, resolve));
      const left = await send(bob.socket, SOCKET_EVENTS.ROOM_LEAVE, { code: room.code });
      const update = await aliceHears;

      expect(left).toEqual({ ok: true, data: { left: true } });
      expect(update.seats.map((seat) => seat.playerId)).toEqual([room.you]);
      expect(update.rematch).toEqual(
        expect.objectContaining({ available: false, leftName: bob.identity.displayName }),
      );
      // The rematch Alice asked for went with him.
      expect(update.requests).toEqual([]);
      // Read back from MongoDB, the room still says who left.
      const again = await send(alice.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
      expect(again.data.rematch.leftName).toBe(bob.identity.displayName);
    } finally {
      players.forEach((p) => p.socket.disconnect());
      await app.close();
    }
  });

  it("counts a match for achievements, streaks and quests in MongoDB, and pushes the unlock (CC-054, CC-089)", async () => {
    const app = await start();
    const players = [];
    try {
      const alice = await connectedGuest(app.url);
      const bob = await connectedGuest(app.url);
      players.push(alice, bob);
      const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);
      const unlockedPush = new Promise((resolve) =>
        alice.socket.once(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, resolve),
      );
      const api = async (path) =>
        await (await fetch(`${app.url}/api${path}`, { headers: { cookie: alice.cookie } })).json();

      const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
        gameId: "rps",
        options: { bestOf: 1 },
      });
      await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
      await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "paper" } });
      await send(bob.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "rock" } });

      expect((await unlockedPush).achievements.map((a) => a.id)).toEqual(["first-match", "first-win"]);
      const achievements = await eventually(async () => {
        const list = (await api("/achievements")).achievements;
        return list.find((a) => a.id === "first-win").unlockedAt === null ? undefined : list;
      });
      expect(achievements.filter((a) => a.unlockedAt !== null).map((a) => a.id)).toEqual([
        "first-match",
        "first-win",
      ]);
      expect((await api("/streaks")).streaks).toEqual(
        expect.objectContaining({ win: { current: 1, best: 1 } }),
      );
      const { quests } = await api("/quests");
      // Every player's win slot has a win quest; one win always moves it.
      const winQuest = quests.items[1];
      expect(winQuest.progress).toBe(1);

      const stored = await readCollection(app.config.mongoUri, "player_achievements");
      expect(stored.filter((u) => u.playerId === alice.identity.id)).toHaveLength(2);
      expect(await readCollection(app.config.mongoUri, "player_stats")).toHaveLength(2);
      expect(await readCollection(app.config.mongoUri, "player_quests")).toHaveLength(2);
    } finally {
      players.forEach((p) => p.socket.disconnect());
      await app.close();
    }
  });
  it("records a game left before anyone played, and gives nobody XP, a win or an achievement for it (CC-095)", async () => {
    const app = await start();
    const players = [];
    try {
      const alice = await connectedGuest(app.url);
      const bob = await connectedGuest(app.url);
      players.push(alice, bob);
      const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);
      const pushed = new Promise((resolve) => alice.socket.once(SOCKET_EVENTS.PROGRESS_UPDATED, resolve));
      const api = async (path) =>
        await (await fetch(`${app.url}/api${path}`, { headers: { cookie: alice.cookie } })).json();

      const { data: room } = await send(alice.socket, SOCKET_EVENTS.ROOM_CREATE, {
        gameId: "tictactoe",
        options: {},
      });
      await send(bob.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
      const finished = new Promise((resolve) =>
        alice.socket.on(SOCKET_EVENTS.ROOM_UPDATED, (view) => view.status === "finished" && resolve(view)),
      );
      await send(bob.socket, SOCKET_EVENTS.ROOM_LEAVE, { code: room.code });

      const update = await pushed;
      expect(update).toEqual(
        expect.objectContaining({ xpGained: 0, counted: false, notCountedReason: "ended-too-soon" }),
      );
      // The result on screen finds its update by this id, whichever of the two arrives first (CC-235).
      expect((await finished).game.matchId).toBe(update.matchId);
      const [stored] = await eventually(async () => {
        const docs = await readCollection(app.config.mongoUri, "matches");
        return docs[0]?.credit === undefined ? undefined : docs;
      });
      expect(stored.result.winners).toEqual([alice.identity.id]);
      expect(stored.credit.notCounted.map((entry) => entry.reason)).toEqual([
        "ended-too-soon",
        "ended-too-soon",
      ]);
      expect((await api("/progress")).progress).toEqual(
        expect.objectContaining({ xp: 0, wins: 0, matchesPlayed: 0 }),
      );
      const [summary] = (await api("/matches")).matches;
      expect(summary).toEqual(
        expect.objectContaining({
          outcomeForYou: "win",
          countsForYou: { counted: false, reason: "ended-too-soon" },
        }),
      );
      const { achievements } = await api("/achievements");
      expect(achievements.filter((a) => a.unlockedAt !== null)).toEqual([]);
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

describe("signing in from a guest session (integration)", () => {
  it("disconnects the guest's sockets: the old session is over", async () => {
    const app = await start();
    let socket;
    try {
      const guest = await fetch(`${app.url}/api/session/guest`, { method: "POST" });
      const cookie = guest.headers.get("set-cookie").split(";")[0];
      socket = connect(app.url, { transports: ["websocket"], extraHeaders: { cookie }, reconnection: false });
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", (err) => reject(describeConnectError(err)));
      });
      const disconnected = new Promise((resolve) => socket.once("disconnect", resolve));

      const signup = await fetch(`${app.url}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          username: "Riya",
          email: "riya@example.com",
          password: "correct horse battery",
        }),
      });

      expect(signup.status).toBe(201);
      expect(await disconnected).toBe("io server disconnect");
    } finally {
      socket?.disconnect();
      await app.close();
    }
  });
});

describe("a guest's progress moving to their account through the real composition root (integration, CC-032)", () => {
  const json = { "Content-Type": "application/json" };
  // An adult, so the name shows on the public boards (CC-152).
  const RIYA = {
    username: "Riya",
    email: "riya@example.com",
    password: "correct horse battery",
    birthYear: 1990,
  };

  async function guest(url) {
    const res = await fetch(`${url}/api/session/guest`, { method: "POST" });
    const cookie = res.headers.get("set-cookie").split(";")[0];
    const socket = connect(url, { transports: ["websocket"], extraHeaders: { cookie }, reconnection: false });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", (err) => reject(describeConnectError(err)));
    });
    return { socket, cookie, identity: (await res.json()).identity };
  }

  const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);

  /** One game of Rock Paper Scissors: `winner` plays rock, `loser` scissors. Returns the room code. */
  async function play(winner, loser, { lastMove } = {}) {
    const { data: room } = await send(winner.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "rps",
      options: { bestOf: 1 },
    });
    await send(loser.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
    await send(winner.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "rock" } });
    const finish = () =>
      send(loser.socket, SOCKET_EVENTS.GAME_MOVE, { code: room.code, move: { choice: "scissors" } });
    return lastMove ? { finish } : finish();
  }

  const api = async (url, path, cookie) => (await fetch(`${url}/api${path}`, { headers: { cookie } })).json();
  const progressOf = (url, cookie, matchesPlayed) =>
    eventually(async () => {
      const { progress } = await api(url, "/progress", cookie);
      return progress.matchesPlayed === matchesPlayed ? progress : undefined;
    });

  /**
   * Waits until gamification has counted the player's first match (achievements are its last step) and answers
   * the bonus XP their daily quests paid — the day's quests depend on the player id and the date (CC-089).
   */
  const questBonusOf = async (url, cookie) => {
    await eventually(async () => {
      const { achievements } = await api(url, "/achievements", cookie);
      return achievements.find((a) => a.id === "first-match").unlockedAt ?? undefined;
    });
    const { quests } = await api(url, "/quests", cookie);
    const done = quests.items.filter((item) => item.completedAt !== null);
    return (
      done.reduce((xp, item) => xp + item.bonusXp, 0) +
      (quests.sweep.completedAt === null ? 0 : quests.sweep.bonusXp)
    );
  };

  it("moves totals and history exactly once on sign-up, and the moved match still replays", async () => {
    const app = await start();
    const sockets = [];
    try {
      const alice = await guest(app.url);
      const bob = await guest(app.url);
      sockets.push(alice.socket, bob.socket);
      await play(alice, bob);
      await progressOf(app.url, alice.cookie, 1);
      const bonus = await questBonusOf(app.url, alice.cookie);
      // Before signing up, the guest is on the boards under its server-given name (ADR-060). The list and `you`
      // are two reads, so the probe waits until both show the whole score.
      const asGuest = await eventually(async () => {
        const weekly = await api(app.url, "/leaderboards/weekly", alice.cookie);
        const row = weekly.entries.find((entry) => entry.displayName === alice.identity.displayName);
        return row?.score === 30 + bonus ? weekly : undefined;
      });
      expect(asGuest.you).toEqual(expect.objectContaining({ listed: true, score: 30 + bonus }));

      const signup = await fetch(`${app.url}/api/auth/signup`, {
        method: "POST",
        headers: { ...json, cookie: alice.cookie },
        body: JSON.stringify(RIYA),
      });
      const cookie = signup.headers.get("set-cookie").split(";")[0];
      const body = await signup.json();
      const { matches } = await api(app.url, "/matches", cookie);
      const { match } = await api(app.url, `/matches/${matches[0].matchId}`, cookie);
      const rps = ENGINES.find((engine) => engine.id === "rps");
      const replayed = replayGame(rps, {
        players: match.players.map((p) => p.playerId),
        options: match.options,
        seed: match.seed,
        log: match.log,
      });
      const [transfer] = await readCollection(app.config.mongoUri, "player_transfers");
      const progressDocs = await readCollection(app.config.mongoUri, "player_progress");

      const { achievements } = await api(app.url, "/achievements", cookie);
      const { streaks } = await api(app.url, "/streaks", cookie);

      const boards = await eventually(async () => {
        const [overallBoard, weeklyBoard, winsBoard] = await Promise.all(
          ["overall", "weekly", "rock-paper-scissors"].map((id) =>
            api(app.url, `/leaderboards/${id}`, cookie),
          ),
        );
        return overallBoard.you.listed && winsBoard.you.listed
          ? { overallBoard, weeklyBoard, winsBoard }
          : undefined;
      });
      const guestRows = (await readCollection(app.config.mongoUri, "leaderboard_entries")).filter(
        (entry) => entry.playerId === alice.identity.id,
      );

      expect(body.carriedOver).toEqual({ xp: 30 + bonus, matchesPlayed: 1, matches: 1 });
      // The carried-over XP and win put the new account on the leaderboards (CC-053), and the guest's rows went
      // with it: its quest XP is on this week's board too, and nothing is there twice (ADR-060).
      for (const board of [boards.overallBoard, boards.weeklyBoard]) {
        expect(board.entries.map(({ displayName, score }) => [displayName, score])).toEqual(
          expect.arrayContaining([["Riya", 30 + bonus]]),
        );
        expect(board.entries.map((entry) => entry.displayName)).not.toContain(alice.identity.displayName);
        expect(board.you).toEqual(expect.objectContaining({ listed: true, score: 30 + bonus }));
      }
      expect(boards.winsBoard.entries).toEqual([
        expect.objectContaining({ rank: 1, displayName: "Riya", score: 1 }),
      ]);
      expect(guestRows).toEqual([]);
      expect((await api(app.url, "/progress", cookie)).progress).toEqual(
        expect.objectContaining({ xp: 30 + bonus, matchesPlayed: 1, wins: 1 }),
      );
      // Achievements and streaks came along too (CC-054, CC-089).
      expect(achievements.filter((a) => a.unlockedAt !== null).map((a) => a.id)).toEqual(
        expect.arrayContaining(["first-match", "first-win"]),
      );
      expect(streaks.win.current).toBe(1);
      expect(streaks.daily.current).toBe(1);
      // History names the account by its id for this match (CC-297), consistently enough to replay the game.
      expect(match.players[0]).toEqual({
        playerId: match.you,
        displayName: "Riya",
        // An adult account links to its profile by a random handle (CC-034).
        profile: expect.stringMatching(/^[0-9a-hjkmnp-tv-z]{16}$/),
      });
      expect(match.result.winners).toEqual([match.you]);
      expect(JSON.stringify(match)).not.toContain(body.identity.id);
      expect(rps.getOutcome(replayed)).toEqual({ status: "finished", ...match.result });
      expect(transfer).toEqual(
        expect.objectContaining({ from: alice.identity.id, status: "done", to: body.identity }),
      );
      // The guest keeps only a marker naming the account; the account holds the totals.
      expect(progressDocs.find((doc) => doc.playerId === alice.identity.id).mergedInto).toBe(
        body.identity.id,
      );
      expect(progressDocs.find((doc) => doc.playerId === body.identity.id).mergedFrom).toEqual([
        alice.identity.id,
      ]);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    }
  });

  it("adds a guest's games to an existing account on login: totals summed, histories joined", async () => {
    const app = await start();
    const sockets = [];
    try {
      const signup = await fetch(`${app.url}/api/auth/signup`, {
        method: "POST",
        headers: json,
        body: JSON.stringify(RIYA),
      });
      const accountCookie = signup.headers.get("set-cookie").split(";")[0];
      const account = connect(app.url, {
        transports: ["websocket"],
        extraHeaders: { cookie: accountCookie },
        reconnection: false,
      });
      await new Promise((resolve) => account.once("connect", resolve));
      const rival = await guest(app.url);
      sockets.push(account, rival.socket);
      await play({ socket: account }, rival); // the account wins: 30 XP, plus its quest bonus
      await progressOf(app.url, accountCookie, 1);
      const accountBonus = await questBonusOf(app.url, accountCookie);
      const visitor = await guest(app.url);
      const friend = await guest(app.url);
      sockets.push(visitor.socket, friend.socket);
      await play(friend, visitor); // the guest loses: 10 XP, plus its quest bonus
      await progressOf(app.url, visitor.cookie, 1);
      const visitorBonus = await questBonusOf(app.url, visitor.cookie);

      const login = await fetch(`${app.url}/api/auth/login`, {
        method: "POST",
        headers: { ...json, cookie: visitor.cookie },
        body: JSON.stringify({ email: RIYA.email, password: RIYA.password }),
      });
      const cookie = login.headers.get("set-cookie").split(";")[0];

      expect((await login.json()).carriedOver).toEqual({
        xp: 10 + visitorBonus,
        matchesPlayed: 1,
        matches: 1,
      });
      expect((await api(app.url, "/progress", cookie)).progress).toEqual(
        expect.objectContaining({
          xp: 40 + accountBonus + visitorBonus,
          matchesPlayed: 2,
          wins: 1,
          losses: 1,
        }),
      );
      expect((await api(app.url, "/matches", cookie)).matches.map((m) => m.outcomeForYou).sort()).toEqual([
        "loss",
        "win",
      ]);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    }
  });

  it("credits the account for a match that finishes while its guest is signing up", async () => {
    const app = await start();
    const sockets = [];
    try {
      const alice = await guest(app.url);
      const bob = await guest(app.url);
      sockets.push(alice.socket, bob.socket);
      const { finish } = await play(bob, alice, { lastMove: true }); // alice is about to lose: 10 XP

      const [signup] = await Promise.all([
        fetch(`${app.url}/api/auth/signup`, {
          method: "POST",
          headers: { ...json, cookie: alice.cookie },
          body: JSON.stringify(RIYA),
        }),
        finish(),
      ]);
      const cookie = signup.headers.get("set-cookie").split(";")[0];

      const progress = await progressOf(app.url, cookie, 1);
      expect(progress).toEqual(expect.objectContaining({ xp: 10, losses: 1 }));
      expect((await api(app.url, "/matches", cookie)).matches).toHaveLength(1);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    }
  });
  it("stops counting the guest's games past the daily limit with one opponent once they join the account (CC-095)", async () => {
    // Half past ten UTC, moving on in real time: every game falls in one hour and one day.
    const startedAt = Date.now();
    const app = await start(freshConfig(), {
      now: () => Date.parse("2026-10-16T10:30:00Z") + Date.now() - startedAt,
    });
    const sockets = [];
    const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
    try {
      const signup = await fetch(`${app.url}/api/auth/signup`, {
        method: "POST",
        headers: json,
        body: JSON.stringify(RIYA),
      });
      const accountCookie = signup.headers.get("set-cookie").split(";")[0];
      const account = connect(app.url, {
        transports: ["websocket"],
        extraHeaders: { cookie: accountCookie },
        reconnection: false,
      });
      await new Promise((resolve) => account.once("connect", resolve));
      const rival = await guest(app.url);
      const visitor = await guest(app.url);
      sockets.push(account, rival.socket, visitor.socket);
      for (let game = 0; game < 6; game += 1) {
        await play({ socket: account }, rival);
        await pause();
      }
      await progressOf(app.url, accountCookie, 6);
      for (let game = 0; game < 6; game += 1) {
        await play(visitor, rival);
        await pause();
      }
      await progressOf(app.url, visitor.cookie, 6);

      const login = await fetch(`${app.url}/api/auth/login`, {
        method: "POST",
        headers: { ...json, cookie: visitor.cookie },
        body: JSON.stringify({ email: RIYA.email, password: RIYA.password }),
      });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const { matches } = await api(app.url, "/matches?limit=50", cookie);

      // Ten counted games with that opponent today, never twelve. All twelve stay in the history.
      expect((await login.json()).carriedOver).toEqual(
        expect.objectContaining({ matchesPlayed: 4, matches: 6 }),
      );
      expect((await api(app.url, "/progress", cookie)).progress).toEqual(
        expect.objectContaining({ matchesPlayed: 10, wins: 10 }),
      );
      expect(matches).toHaveLength(12);
      expect(matches.filter((m) => !m.countsForYou.counted).map((m) => m.countsForYou.reason)).toEqual([
        "opponent-daily-limit",
        "opponent-daily-limit",
      ]);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    }
  }, 20_000);
});

describe("leaderboards and rematches through the real composition root (integration, CC-053, CC-037)", () => {
  async function socketFor(url, cookie) {
    const socket = connect(url, { transports: ["websocket"], extraHeaders: { cookie }, reconnection: false });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", (err) => reject(describeConnectError(err)));
    });
    return socket;
  }
  async function account(url, username) {
    const res = await fetch(`${url}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Adults, so their names show on the public boards (CC-152).
      body: JSON.stringify({
        username,
        email: `${username}@example.com`,
        password: "correct horse battery",
        birthYear: 1990,
      }),
    });
    const cookie = res.headers.get("set-cookie").split(";")[0];
    return { cookie, identity: (await res.json()).identity, socket: await socketFor(url, cookie) };
  }
  async function guest(url) {
    const res = await fetch(`${url}/api/session/guest`, { method: "POST" });
    const cookie = res.headers.get("set-cookie").split(";")[0];
    return { cookie, identity: (await res.json()).identity, socket: await socketFor(url, cookie) };
  }
  const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);
  /** One best-of-1 Rock Paper Scissors game in `code` that `winner` wins. */
  async function playRound(code, winner, loser) {
    await send(winner.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "rock" } });
    return send(loser.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "scissors" } });
  }
  async function newRoom(host, other) {
    const { data } = await send(host.socket, SOCKET_EVENTS.ROOM_CREATE, {
      gameId: "rps",
      options: { bestOf: 1 },
    });
    await send(other.socket, SOCKET_EVENTS.ROOM_JOIN, { code: data.code });
    return data.code;
  }

  it("ranks the accounts and the guest of stored matches, and replays a rematch as a second match", async () => {
    const app = await start();
    const players = [];
    try {
      const riya = await account(app.url, "riya");
      const sam = await account(app.url, "sam");
      const visitor = await guest(app.url);
      players.push(riya, sam, visitor);

      const code = await newRoom(riya, sam);
      await playRound(code, riya, sam);
      const asked = await send(sam.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });
      const rematch = await send(riya.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });
      // Views name players by seat id (CC-253): each player's is the `you` of their own view.
      const seat = { riya: rematch.data.you, sam: asked.data.you };
      expect(rematch.data.status).toBe("playing");
      expect(rematch.data.seats.map((each) => each.playerId)).toEqual([seat.sam, seat.riya]);
      const second = await playRound(code, sam, riya);
      expect(second.data.series).toEqual({ games: 2, wins: { [seat.riya]: 1, [seat.sam]: 1 } });
      await playRound(await newRoom(visitor, riya), visitor, riya);

      const board = await eventually(async () => {
        const res = await fetch(`${app.url}/api/leaderboards/rock-paper-scissors`, {
          headers: { cookie: visitor.cookie },
        });
        const body = await res.json();
        return body.entries.length === 3 ? body : undefined;
      });
      const guestName = visitor.identity.displayName;
      // 50, 40 and 30 XP from the matches, plus whatever daily quests paid (they depend on the player and the day).
      const xpOf = async ({ cookie }) => {
        const res = await fetch(`${app.url}/api/progress`, { headers: { cookie } });
        return (await res.json()).progress.xp;
      };
      const { overall, weekly, riyaXp, samXp, guestXp } = await eventually(async () => {
        const [riyaXp, samXp, guestXp] = [await xpOf(riya), await xpOf(sam), await xpOf(visitor)];
        const boardFor = async (id) =>
          (await fetch(`${app.url}/api/leaderboards/${id}`, { headers: { cookie: sam.cookie } })).json();
        const [overall, weekly] = [await boardFor("overall"), await boardFor("weekly")];
        const scores = (body) => Object.fromEntries(body.entries.map((e) => [e.displayName, e.score]));
        const settled = (body) =>
          scores(body).riya === riyaXp && scores(body).sam === samXp && scores(body)[guestName] === guestXp;
        return riyaXp >= 50 && samXp >= 40 && guestXp >= 30 && settled(overall) && settled(weekly)
          ? { overall, weekly, riyaXp, samXp, guestXp }
          : undefined;
      });
      const matches = await readCollection(app.config.mongoUri, "matches");

      // One win each: the earlier win ranks higher, so the guest who won last is third (ADR-060).
      expect(board.entries.map(({ displayName, score }) => [displayName, score])).toEqual([
        ["riya", 1],
        ["sam", 1],
        [guestName, 1],
      ]);
      expect(board.you).toEqual({ listed: true, rank: 3, score: 1 });
      // Overall and this week's XP agree for new accounts: match XP and quest bonuses both count for the week.
      for (const body of [overall, weekly]) {
        expect(body.entries.map(({ displayName, score }) => [displayName, score]).sort()).toEqual(
          [
            ["riya", riyaXp],
            ["sam", samXp],
            [guestName, guestXp],
          ].sort(),
        );
        expect(body.you).toEqual(expect.objectContaining({ listed: true, score: samXp }));
      }
      expect(matches.filter((match) => match.roomCode === code)).toHaveLength(2);
      // The guest's rows end 30 days after its game, the accounts' all time rows never (ADR-060).
      const entries = await readCollection(app.config.mongoUri, "leaderboard_entries");
      const allTime = entries.filter((entry) => entry.period === "all");
      expect(allTime.filter((entry) => entry.playerId === visitor.identity.id)).toHaveLength(2);
      for (const entry of allTime) {
        expect(entry.expiresAt !== undefined).toBe(entry.playerId === visitor.identity.id);
      }
    } finally {
      players.forEach((player) => player.socket.disconnect());
      await app.close();
    }
  });
});

describe("legacy player migration through the real composition root (integration, CC-078)", () => {
  it("logs a legacy player in with their old password and leaves the legacy document untouched", async () => {
    const config = freshConfig();
    const legacyDoc = {
      username: "Sam Lee",
      email: "Sam@Example.com",
      password: bcrypt.hashSync("old password 1", 4),
      level: 7,
    };
    const seeding = await mongoose.createConnection(config.mongoUri).asPromise();
    await seeding.db.collection("users").insertOne(legacyDoc);
    await seeding.close();
    const app = await start(config);
    try {
      const login = await fetch(`${app.url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "sam@example.com", password: "old password 1" }),
      });
      const { identity } = await login.json();
      const [account] = await readCollection(config.mongoUri, "accounts");

      expect(login.status).toBe(200);
      expect(identity).toEqual({
        kind: "user",
        id: `user_${account._id.toHexString()}`,
        displayName: "Sam_Lee",
      });
      expect(account).toMatchObject({
        email: "sam@example.com",
        passwordHash: expect.stringMatching(/^scrypt\$/),
      });
      expect(await readCollection(config.mongoUri, "users")).toEqual([legacyDoc]);
    } finally {
      await app.close();
    }
  });
});

describe("createSessionStore (integration)", () => {
  /** Plays the store's part of a visit, the way express-session does for an unchanged session. */
  const touch = (store, sid, session) =>
    new Promise((resolve, reject) => store.touch(sid, session, (err) => (err ? reject(err) : resolve())));
  const set = (store, sid, session) =>
    new Promise((resolve, reject) => store.set(sid, session, (err) => (err ? reject(err) : resolve())));
  const get = (store, sid) =>
    new Promise((resolve, reject) => store.get(sid, (err, value) => (err ? reject(err) : resolve(value))));
  const cookieFor = (expires) => ({
    originalMaxAge: 1000,
    expires: new Date(expires),
    httpOnly: true,
    path: "/",
  });

  it("moves a returning player's stored expiry forward, writing at most once per touch interval (CC-096)", async () => {
    const database = await connectDatabase({
      uri: mongo.uri(`roll-${++dbCounter}`),
      logger: captureLogger().logger,
    });
    try {
      const often = await createSessionStore({
        client: database.client,
        ttlSeconds: 60,
        touchAfterSeconds: 0,
      });
      const rarely = await createSessionStore({
        client: database.client,
        ttlSeconds: 60,
        touchAfterSeconds: 3600,
      });
      const day = 24 * 60 * 60 * 1000;
      await set(often, "sid-often", { cookie: cookieFor(Date.now() + day), identity: { kind: "guest" } });
      await set(rarely, "sid-rarely", { cookie: cookieFor(Date.now() + day), identity: { kind: "guest" } });

      const later = Date.now() + 25 * day;
      await touch(often, "sid-often", { ...(await get(often, "sid-often")), cookie: cookieFor(later) });
      await touch(rarely, "sid-rarely", { ...(await get(rarely, "sid-rarely")), cookie: cookieFor(later) });

      const docs = await database.connection.db.collection(SESSION_COLLECTION).find().toArray();
      const expiry = (id) => docs.find((doc) => doc._id === id).expires.getTime();
      expect(expiry("sid-often")).toBe(later);
      expect(expiry("sid-rarely")).toBeLessThan(later); // touched within the hour: no write
    } finally {
      await database.close();
    }
  });

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
