import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CODES, SOCKET_EVENTS } from "@classicade/shared";
import { ENGINES } from "@classicade/games";
import { createSocketClients, send } from "../../testing/socketClients.js";
import { startTestServer } from "../../testing/testApp.js";

// Games against a computer character over real sockets (CC-138, CC-221, CC-225), with the real engines and bots.
// The test server lets computer players act at once.
let server;
const clients = createSocketClients(() => server.baseUrl);

afterEach(async () => {
  clients.disconnectAll();
  await server?.close();
  server = undefined;
});

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Resolves with the next room update that passes `test`. */
const updateWhere = (socket, test) =>
  new Promise((resolve) => {
    const listener = (view) => {
      if (test(view)) {
        socket.off(SOCKET_EVENTS.ROOM_UPDATED, listener);
        resolve(view);
      }
    };
    socket.on(SOCKET_EVENTS.ROOM_UPDATED, listener);
  });

describe("playing a computer character over sockets", () => {
  it("starts a game at once against Rocky, labelled as a computer player, with his throw locked", async () => {
    server = await startTestServer({ engines: ENGINES });
    const alice = await clients.player();

    const answer = await send(alice.socket, SOCKET_EVENTS.ROOM_PLAY_COMPUTER, {
      gameId: "rps",
      level: "easy",
    });

    expect(answer.ok).toBe(true);
    expect(answer.data.status).toBe("playing");
    expect(answer.data.seats[1]).toEqual({
      playerId: "bot_rocky_easy",
      displayName: "Rocky",
      connected: true,
      bot: { character: "rocky", level: "easy" },
    });
    expect(answer.data.fairness.locked).toEqual([
      { playerId: "bot_rocky_easy", commitment: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
  });

  it("plays Rock Paper Scissors to a result, and every lock shown before a round matches its reveal", async () => {
    server = await startTestServer({ engines: ENGINES });
    const alice = await clients.player();
    const started = await send(alice.socket, SOCKET_EVENTS.ROOM_PLAY_COMPUTER, {
      gameId: "rps",
      level: "hard",
      options: { bestOf: 3 },
    });
    const { code } = started.data;
    const locksSeen = [started.data.fairness.locked[0].commitment];
    let view = started.data;

    for (let round = 0; view.status === "playing" && round < 20; round++) {
      const over = (v) => v.game.view.rounds.length > round || v.status !== "playing";
      const resolved = updateWhere(alice.socket, over);
      const own = (await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "rock" } }))
        .data;
      view = over(own) ? own : await resolved;
      if (view.status === "playing") locksSeen.push(view.fairness.locked[0].commitment);
    }

    expect(view.status).toBe("finished");
    const { checks } = view.fairness;
    expect(checks.map((check) => check.commitment)).toEqual(locksSeen.slice(0, checks.length));
    checks.forEach((check, index) => {
      expect(sha256(`${check.text}:${check.salt}`)).toBe(check.commitment);
      expect(JSON.parse(check.text).choice).toBe(view.game.view.rounds[index].choices.bot_rocky_hard);
    });
  });

  it("plays Tic-Tac-Toe against Unbeatable Pip, who never loses", async () => {
    server = await startTestServer({ engines: ENGINES });
    const alice = await clients.player();
    const { code } = (
      await send(alice.socket, SOCKET_EVENTS.ROOM_PLAY_COMPUTER, { gameId: "tictactoe", level: "hard" })
    ).data;
    // Pip's moves come as updates, which can overtake the answer to Alice's join or move: the newest revision wins.
    let latest = { revision: 0 };
    const keep = (view) => {
      if (view.revision > latest.revision) latest = view;
    };
    alice.socket.on(SOCKET_EVENTS.ROOM_UPDATED, keep);
    keep((await send(alice.socket, SOCKET_EVENTS.ROOM_JOIN, { code })).data);
    const settled = async () => {
      for (;;) {
        if (latest.status !== "playing" || latest.game.activePlayers.includes(alice.identity.id))
          return latest;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    for (let move = 0; (await settled()).status === "playing" && move < 5; move++) {
      const cell = latest.game.view.board.indexOf("");
      keep((await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell } })).data);
    }

    const final = await settled();
    expect(final.status).toBe("finished");
    expect(final.game.outcome.winners).not.toContain(alice.identity.id);
  });

  it("accepts a rematch the person asks for, and the new game starts", async () => {
    server = await startTestServer({ engines: ENGINES });
    const alice = await clients.player();
    const { code } = (
      await send(alice.socket, SOCKET_EVENTS.ROOM_PLAY_COMPUTER, {
        gameId: "rps",
        level: "easy",
        options: { bestOf: 1 },
      })
    ).data;
    let view;
    for (let round = 0; view?.status !== "finished"; round++) {
      const over = (v) => v.game.view.rounds.length > round || v.status !== "playing";
      const next = updateWhere(alice.socket, over);
      const own = (await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "paper" } }))
        .data;
      view = over(own) ? own : await next;
    }

    const restarted = updateWhere(alice.socket, (v) => v.status === "playing");
    await send(alice.socket, SOCKET_EVENTS.ROOM_REMATCH, { code });

    expect((await restarted).series.games).toBe(1);
  });

  it("refuses a level the character does not have, and creates nothing", async () => {
    server = await startTestServer({ engines: ENGINES });
    const alice = await clients.player();

    const answer = await send(alice.socket, SOCKET_EVENTS.ROOM_PLAY_COMPUTER, {
      gameId: "rps",
      level: "medium",
    });

    expect(answer).toEqual({
      ok: false,
      error: expect.objectContaining({ code: ERROR_CODES.VALIDATION_FAILED }),
    });
  });

  it("does not let a person move for the computer", async () => {
    server = await startTestServer({ engines: ENGINES });
    const alice = await clients.player();
    const { code } = (
      await send(alice.socket, SOCKET_EVENTS.ROOM_PLAY_COMPUTER, { gameId: "rps", level: "easy" })
    ).data;

    const answer = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, {
      code,
      move: { choice: "rock" },
      playerId: "bot_rocky_easy",
    });

    expect(answer.ok).toBe(false);
  });
});
