import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";
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
  // A failing test shows what the server saw (refused sockets, session lookups) — rare flakes explain themselves.
  onTestFailed(() => {
    process.stderr.write(`\n--- server log (${config.mongoUri.split("/").pop()}) ---\n`);
    capture.entries.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`));
  });
  const app = await startServer({ config, logger: capture.logger });
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
      expect(progress).toEqual(expect.objectContaining({ wins: 1 }));
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
  const RIYA = { username: "Riya", email: "riya@example.com", password: "correct horse battery" };

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

      expect(body.carriedOver).toEqual({ xp: 30 + bonus, matchesPlayed: 1, matches: 1 });
      expect((await api(app.url, "/progress", cookie)).progress).toEqual(
        expect.objectContaining({ xp: 30 + bonus, matchesPlayed: 1, wins: 1 }),
      );
      // Achievements and streaks came along too (CC-054, CC-089).
      expect(achievements.filter((a) => a.unlockedAt !== null).map((a) => a.id)).toEqual(
        expect.arrayContaining(["first-match", "first-win"]),
      );
      expect(streaks.win.current).toBe(1);
      expect(streaks.daily.current).toBe(1);
      expect(match.players[0]).toEqual({ playerId: body.identity.id, displayName: "Riya" });
      expect(match.result.winners).toEqual([body.identity.id]);
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
      body: JSON.stringify({ username, email: `${username}@example.com`, password: "correct horse battery" }),
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

  it("ranks the accounts of stored matches, never the guest, and replays a rematch as a second match", async () => {
    const app = await start();
    const players = [];
    try {
      const riya = await account(app.url, "riya");
      const sam = await account(app.url, "sam");
      const visitor = await guest(app.url);
      players.push(riya, sam, visitor);

      const code = await newRoom(riya, sam);
      await playRound(code, riya, sam);
      await send(sam.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });
      const rematch = await send(riya.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });
      expect(rematch.data.status).toBe("playing");
      expect(rematch.data.seats.map((seat) => seat.playerId)).toEqual([sam.identity.id, riya.identity.id]);
      const second = await playRound(code, sam, riya);
      expect(second.data.series).toEqual({ games: 2, wins: { [riya.identity.id]: 1, [sam.identity.id]: 1 } });
      await playRound(await newRoom(visitor, riya), visitor, riya);

      const board = await eventually(async () => {
        const res = await fetch(`${app.url}/api/leaderboards/rock-paper-scissors`, {
          headers: { cookie: visitor.cookie },
        });
        const body = await res.json();
        return body.entries.length === 2 ? body : undefined;
      });
      const overall = await eventually(async () => {
        const res = await fetch(`${app.url}/api/leaderboards/overall`, { headers: { cookie: sam.cookie } });
        const body = await res.json();
        return body.entries[0]?.score === 50 ? body : undefined;
      });
      const matches = await readCollection(app.config.mongoUri, "matches");

      expect(board.entries.map(({ displayName, score }) => [displayName, score])).toEqual([
        ["riya", 1],
        ["sam", 1],
      ]);
      expect(board.you).toEqual({ listed: false, reason: "guest" });
      expect(overall.entries.map(({ displayName, score }) => [displayName, score])).toEqual([
        ["riya", 50],
        ["sam", 40],
      ]);
      expect(overall.you).toEqual({ listed: true, rank: 2, score: 40 });
      expect(matches.filter((match) => match.roomCode === code)).toHaveLength(2);
      const entries = await readCollection(app.config.mongoUri, "leaderboard_entries");
      expect(entries.some((entry) => entry.playerId === visitor.identity.id)).toBe(false);
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
