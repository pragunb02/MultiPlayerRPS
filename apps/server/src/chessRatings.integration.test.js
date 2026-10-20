import mongoose from "mongoose";
import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { startServer } from "./server.js";
import { captureLogger } from "./testing/captureLogger.js";
import { startMemoryMongo } from "./testing/memoryMongo.js";
import { testConfig } from "./testing/testConfig.js";

// The chess rating through the real composition root, real MongoDB (in memory) and real HTTP and WebSocket
// (CC-042): a guest's rated game, the rating moving on sign up, export and deletion. One MongoDB and one server
// for the file: the tests share no players, and starting a server builds every index, which took seconds of each
// test's 5 s on a busy runner (CC-306, CC-309).
let mongo;
let app;

beforeAll(async () => {
  mongo = await startMemoryMongo();
  const config = testConfig({ MONGO_URI: mongo.uri("chess-ratings") });
  const capture = captureLogger();
  const server = await startServer({ config, logger: capture.logger });
  app = { ...server, ...capture, config, url: `http://127.0.0.1:${server.port}` };
}, 120_000);

afterAll(async () => {
  await app?.close();
  await mongo?.stop();
});

beforeEach(() => {
  onTestFailed(() => app.entries.forEach((entry) => process.stderr.write(`${JSON.stringify(entry)}\n`)));
});

async function readCollection(uri, name, filter = {}) {
  const connection = await mongoose.createConnection(uri).asPromise();
  try {
    return await connection.db.collection(name).find(filter).toArray();
  } finally {
    await connection.close();
  }
}

const PASSWORD = "correct horse battery";

async function call(url, method, path, { body, cookie } = {}) {
  const res = await fetch(`${url}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  return {
    status: res.status,
    body: text === "" ? {} : JSON.parse(text),
    cookie: setCookie ? setCookie.split(";")[0] : cookie,
  };
}

async function socketFor(url, cookie) {
  const socket = connect(url, { transports: ["websocket"], extraHeaders: { cookie }, reconnection: false });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

const send = (socket, event, payload) => socket.timeout(2_000).emitWithAck(event, payload);

/**
 * Black mates in two. The room's seed decides the colours, so they are read from the joiner's view. Views name
 * players by their seat in the room, the viewer's own as `you` (CC-253), never by player id: reading the colour
 * by player id found none, so the host was always taken for White, and half the games stalled on a refused move
 * until the test timed out (CC-306).
 */
async function playChess(host, joiner) {
  const { data: room } = await send(host.socket, SOCKET_EVENTS.ROOM_CREATE, { gameId: "chess", options: {} });
  const { data: started } = await send(joiner.socket, SOCKET_EVENTS.ROOM_JOIN, { code: room.code });
  const joinerColour = started.game.view.colors[started.you];
  expect(["w", "b"]).toContain(joinerColour);
  const white = joinerColour === "w" ? joiner : host;
  const black = white === joiner ? host : joiner;
  // A refused move fails here, with the server's reason, instead of leaving the game unfinished.
  const move = async (player, from, to) => {
    const ack = await send(player.socket, SOCKET_EVENTS.GAME_MOVE, {
      code: room.code,
      move: { type: "move", from, to },
    });
    expect(ack.error).toBeUndefined();
  };
  await move(white, "f2", "f3");
  await move(black, "e7", "e5");
  await move(white, "g2", "g4");
  await move(black, "d8", "h4");
  return { code: room.code, winner: black };
}

describe("the chess rating through the real composition root (integration, CC-042)", () => {
  it("rates a guest, moves the rating on sign up, exports it and erases it with the account", async () => {
    const sockets = [];
    try {
      const uri = app.config.mongoUri;
      const samUp = await call(app.url, "POST", "/auth/signup", {
        body: { username: "sam", email: "sam@example.com", password: PASSWORD },
      });
      const sam = { cookie: samUp.cookie, id: samUp.body.identity.id };
      sam.socket = await socketFor(app.url, sam.cookie);
      const guest = await call(app.url, "POST", "/session/guest");
      const riya = { cookie: guest.cookie, id: guest.body.identity.id };
      riya.socket = await socketFor(app.url, riya.cookie);
      sockets.push(sam.socket, riya.socket);

      await playChess(riya, sam);
      // The match pipeline rates the game in the background: wait for it to say so, not on a timer.
      await app.once("chess ratings applied");
      const [guestRating] = await readCollection(uri, "chess_ratings", { playerId: riya.id, games: 1 });
      expect(guestRating).toBeDefined();
      expect(app.find("chess ratings applied")).toHaveLength(1);

      const riyaUp = await call(app.url, "POST", "/auth/signup", {
        body: { username: "riya", email: "riya@example.com", password: PASSWORD },
        cookie: riya.cookie,
      });
      expect(riyaUp.status).toBe(201);
      const accountId = riyaUp.body.identity.id;
      const [account] = await readCollection(uri, "chess_ratings", { playerId: accountId });
      expect(account).toMatchObject({ rating: guestRating.rating, games: 1, mergedFrom: [riya.id] });
      expect((await readCollection(uri, "chess_ratings", { playerId: riya.id }))[0].mergedInto).toBe(
        accountId,
      );

      const exported = await call(app.url, "POST", "/account/export", {
        body: { password: PASSWORD },
        cookie: riyaUp.cookie,
      });
      expect(exported.status).toBe(200);
      expect(exported.body.chessRatings).toEqual(
        expect.objectContaining({ rating: guestRating.rating, games: 1, provisional: true }),
      );
      expect(exported.body.chessRatings.changes).toHaveLength(1);

      const deleted = await call(app.url, "POST", "/account/delete", {
        body: { password: PASSWORD },
        cookie: riyaUp.cookie,
      });
      expect(deleted.status).toBe(204);
      expect(await readCollection(uri, "chess_ratings", { playerId: { $in: [accountId, riya.id] } })).toEqual(
        [],
      );
      expect(await readCollection(uri, "chess_ratings", { playerId: sam.id })).toHaveLength(1);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
    }
  });

  it("builds the unique index on playerId at boot", async () => {
    const connection = await mongoose.createConnection(app.config.mongoUri).asPromise();
    try {
      const indexes = await connection.db.collection("chess_ratings").indexes();

      expect(indexes.find((index) => index.key.playerId === 1)).toMatchObject({ unique: true });
    } finally {
      await connection.close();
    }
  });
});
