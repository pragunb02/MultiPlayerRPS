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
    // Rocky is named by his seat id, as any player (CC-253), and labelled as a computer.
    const rocky = answer.data.seats[1].playerId;
    expect(rocky).not.toContain("bot_");
    expect(answer.data.seats[1]).toEqual(
      expect.objectContaining({
        playerId: rocky,
        displayName: "Rocky",
        connected: true,
        presence: "here",
        bot: { character: "rocky", level: "easy" },
      }),
    );
    expect(answer.data.fairness.locked).toEqual([
      { playerId: rocky, turn: 0, commitment: expect.stringMatching(/^[0-9a-f]{64}$/) },
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
    const rocky = started.data.seats.find((seat) => seat.bot !== undefined).playerId;
    const locksSeen = [started.data.fairness.locked[0]];
    let view = started.data;

    for (let round = 0; view.status === "playing" && round < 20; round++) {
      const over = (v) => v.game.view.rounds.length > round || v.status !== "playing";
      const resolved = updateWhere(alice.socket, over);
      const own = (await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { choice: "rock" } }))
        .data;
      view = over(own) ? own : await resolved;
      if (view.status === "playing") locksSeen.push(view.fairness.locked[0]);
    }

    expect(view.status).toBe("finished");
    const { checks } = view.fairness;
    // Each check names the same turn as the lock shown before its round, so a browser can match the two.
    expect(checks.map(({ playerId, turn, commitment }) => ({ playerId, turn, commitment }))).toEqual(
      locksSeen.slice(0, checks.length),
    );
    checks.forEach((check, index) => {
      expect(sha256(`${check.text}:${check.salt}`)).toBe(check.commitment);
      expect(JSON.parse(check.text).choice).toBe(view.game.view.rounds[index].choices[rocky]);
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
    const joined = (await send(alice.socket, SOCKET_EVENTS.ROOM_JOIN, { code })).data;
    keep(joined);
    const settled = async () => {
      for (;;) {
        if (latest.status !== "playing" || latest.game.activePlayers.includes(joined.you)) return latest;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    for (let move = 0; (await settled()).status === "playing" && move < 5; move++) {
      const cell = latest.game.view.board.indexOf("");
      keep((await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code, move: { cell } })).data);
    }

    const final = await settled();
    expect(final.status).toBe("finished");
    expect(final.game.outcome.winners).not.toContain(joined.you);
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
    await send(alice.socket, SOCKET_EVENTS.ROOM_REQUEST, { code, type: "rematch" });

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

  it("does not let a person move for the computer: a valid move on the computer's turn is the person's, and refused", async () => {
    server = await startTestServer({ engines: ENGINES });
    // The computer never moves in this test, so its turn stays open for the person to try.
    server.botDriver.stop();
    const alice = await clients.player();
    const started = (
      await send(alice.socket, SOCKET_EVENTS.ROOM_PLAY_COMPUTER, { gameId: "tictactoe", level: "easy" })
    ).data;
    // The stored room names Pip by his player id. Views name him by seat id (CC-253).
    const pip = "bot_pip_easy";
    const aliceFirst = started.game.activePlayers.includes(started.you);
    if (aliceFirst) {
      expect(
        (await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, { code: started.code, move: { cell: 0 } })).ok,
      ).toBe(true);
    }
    const before = await server.roomComponent.getRoom(started.code);
    expect(before.game.state.turn).toBe(pip);

    const answer = await send(alice.socket, SOCKET_EVENTS.GAME_MOVE, {
      code: started.code,
      move: { cell: 4 },
    });

    expect(answer).toEqual({
      ok: false,
      error: expect.objectContaining({ details: { reason: "NOT_YOUR_TURN" } }),
    });
    const after = await server.roomComponent.getRoom(started.code);
    expect(after.game.log).toEqual(before.game.log);
    expect(after.game.log.filter((entry) => entry.playerId === pip)).toEqual([]);
  });
});
