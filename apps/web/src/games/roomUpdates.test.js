import { describe, expect, it } from "vitest";
import {
  incomingRequests,
  outgoingRequests,
  REMATCH_TEXTS,
  requestAnswers,
  roomNotices,
  roomRequests,
  roomSounds,
  textsFor,
} from "./roomUpdates.js";

const ME = "guest_me";
const BOB = "guest_bob";
const seats = [
  { playerId: ME, displayName: "Me", connected: true, presence: "here" },
  { playerId: BOB, displayName: "Bob", connected: true, presence: "here" },
];
const T = 5_000_000;

/** A RoomView of a game the web app has no board for: only the room's own rules apply. */
const room = ({ game = {}, ...overrides } = {}) => ({
  code: "AB2CD3",
  gameId: "ludo",
  status: "playing",
  you: ME,
  seats,
  requests: [],
  game: { view: {}, activePlayers: [BOB], outcome: { status: "ongoing" }, number: 1, ...game },
  ...overrides,
});
const finished = ({ requests = [], rematch = { available: true }, ...overrides } = {}) =>
  room({
    status: "finished",
    rematch,
    requests,
    series: { games: 1, wins: { [ME]: 1 } },
    game: { activePlayers: [], outcome: { status: "finished", result: "win", winners: [ME] } },
    ...overrides,
  });
const chess = (view = {}, overrides = {}) =>
  room({ gameId: "chess", game: { view: { moves: [], ...view }, activePlayers: [ME] }, ...overrides });

/** A request in the shape the server sends (RoomRequest in SOCKET_EVENTS). */
const request = (overrides = {}) => ({
  type: "rematch",
  from: BOB,
  to: ME,
  createdAt: T,
  expiresAt: T + 60_000,
  state: "open",
  endedAt: 0,
  ...overrides,
});
const ended = (state, overrides = {}) => request({ state, endedAt: T + 5, ...overrides });

describe("roomSounds (CC-103)", () => {
  it("is quiet for the first view, so opening or reloading a room makes no sound", () => {
    expect(roomSounds({ previous: undefined, next: room(), hidden: false })).toEqual([]);
  });

  it("is quiet across different rooms and while a room waits for players", () => {
    const waiting = { ...room(), status: "waiting", game: undefined };

    expect(roomSounds({ previous: room(), next: room({ code: "ZZZZZZ" }), hidden: false })).toEqual([]);
    expect(roomSounds({ previous: waiting, next: waiting, hidden: false })).toEqual([]);
  });

  it("plays the start when the game begins, and a rematch is a new start", () => {
    const waiting = { ...room(), status: "waiting", game: undefined };
    const rematch = room({ game: { number: 2 } });

    expect(roomSounds({ previous: waiting, next: room(), hidden: false })).toEqual(["game-start"]);
    expect(roomSounds({ previous: finished(), next: rematch, hidden: false })).toEqual(["game-start"]);
  });

  it("does not compare the new game's board with the last one", () => {
    const lastGame = chess(
      { moves: ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"] },
      { status: "finished" },
    );
    const rematch = chess({}, { game: { view: { moves: [] }, activePlayers: [ME], number: 2 } });

    expect(roomSounds({ previous: lastGame, next: rematch, hidden: false })).toEqual(["game-start"]);
  });

  it("asks the game for its own sounds while the same game goes on", () => {
    const before = chess({ moves: ["e4"] });

    expect(roomSounds({ previous: before, next: chess({ moves: ["e4", "d5"] }), hidden: false })).toEqual([
      "move",
    ]);
  });

  it("has no game sounds for a game the web app knows nothing about", () => {
    expect(roomSounds({ previous: room(), next: room(), hidden: false })).toEqual([]);
  });

  it("follows the deciding move with the viewer's result, and an aborted game ends on the void note", () => {
    const win = { status: "finished", result: "win", winners: [ME] };
    const loss = { status: "finished", result: "win", winners: [BOB] };
    const draw = { status: "finished", result: "draw", winners: [] };
    const aborted = { status: "finished", result: "aborted", winners: [], reason: "aborted" };
    const over = (outcome) => room({ status: "finished", game: { outcome, activePlayers: [] } });

    expect(roomSounds({ previous: room(), next: over(win), hidden: false })).toEqual(["win"]);
    expect(roomSounds({ previous: room(), next: over(loss), hidden: false })).toEqual(["loss"]);
    expect(roomSounds({ previous: room(), next: over(draw), hidden: false })).toEqual(["draw"]);
    expect(roomSounds({ previous: room(), next: over(aborted), hidden: false })).toEqual(["game-void"]);
  });

  it("plays the quiet win for a win by forfeit or the move timer, and the soft loss for the other side (CC-163)", () => {
    const over = (outcome) => room({ status: "finished", game: { outcome, activePlayers: [] } });
    const by = (winner, reason) => over({ status: "finished", result: "win", winners: [winner], reason });

    expect(roomSounds({ previous: room(), next: by(ME, "forfeit"), hidden: false })).toEqual(["win-quiet"]);
    expect(roomSounds({ previous: room(), next: by(ME, "idle"), hidden: false })).toEqual(["win-quiet"]);
    expect(roomSounds({ previous: room(), next: by(BOB, "idle"), hidden: false })).toEqual(["loss"]);
  });

  it("plays no result for a spectator, not even the void note of an aborted game", () => {
    const aborted = { status: "finished", result: "aborted", winners: [], reason: "aborted" };
    const watched = room({ you: "", status: "finished", game: { outcome: aborted, activePlayers: [] } });

    expect(roomSounds({ previous: room({ you: "" }), next: watched, hidden: false })).toEqual([]);
  });

  it("plays the checkmating move and then the win", () => {
    const before = chess({ moves: ["f3", "e5", "g4"] });
    const mated = {
      ...before,
      status: "finished",
      game: {
        ...before.game,
        view: { ...before.game.view, moves: ["f3", "e5", "g4", "Qh4#"] },
        activePlayers: [],
        outcome: { status: "finished", result: "win", winners: [ME] },
      },
    };

    expect(roomSounds({ previous: before, next: mated, hidden: false })).toEqual(["move", "win"]);
  });

  it("gives spectators and players without a seat no result sound", () => {
    const over = room({
      status: "finished",
      game: { outcome: { status: "finished", result: "win", winners: [BOB] }, activePlayers: [] },
    });

    expect(roomSounds({ previous: room({ you: "" }), next: { ...over, you: "" }, hidden: false })).toEqual(
      [],
    );
    expect(
      roomSounds({ previous: room({ you: "ghost" }), next: { ...over, you: "ghost" }, hidden: false }),
    ).toEqual([]);
  });

  it("chimes once when someone asks you something", () => {
    const asked = finished({ requests: [request()] });

    expect(roomSounds({ previous: finished(), next: asked, hidden: false })).toEqual(["notify"]);
    expect(roomSounds({ previous: asked, next: { ...asked }, hidden: false })).toEqual([]);
  });

  it("chimes when your request is answered or runs out, and when the opponent leaves", () => {
    const mine = request({ from: ME, to: BOB });
    const asked = finished({ requests: [mine] });

    expect(
      roomSounds({
        previous: asked,
        next: finished({ requests: [{ ...mine, state: "declined" }] }),
        hidden: false,
      }),
    ).toEqual(["notify"]);
    expect(
      roomSounds({
        previous: asked,
        next: finished({ requests: [{ ...mine, state: "expired" }] }),
        hidden: false,
      }),
    ).toEqual(["notify"]);
    expect(
      roomSounds({ previous: finished(), next: finished({ rematch: { available: false } }), hidden: false }),
    ).toEqual(["notify"]);
  });

  it("is quiet about the viewer's own answer", () => {
    const asked = finished({ requests: [request()] });

    expect(
      roomSounds({ previous: asked, next: finished({ requests: [ended("declined")] }), hidden: false }),
    ).toEqual([]);
    const mine = request({ from: ME, to: BOB });
    expect(
      roomSounds({
        previous: finished({ requests: [mine] }),
        next: finished({ requests: [{ ...mine, state: "withdrawn" }] }),
        hidden: false,
      }),
    ).toEqual([]);
  });

  it("calls you back to a background tab when it became your move", () => {
    const theirs = room();
    const yours = room({ game: { activePlayers: [ME] } });

    expect(roomSounds({ previous: theirs, next: yours, hidden: true })).toEqual(["your-turn"]);
    expect(roomSounds({ previous: theirs, next: yours, hidden: false })).toEqual([]);
    expect(roomSounds({ previous: yours, next: yours, hidden: true })).toEqual([]);
  });

  it("lets the start sound say it when a game begins on your move", () => {
    const waiting = { ...room(), status: "waiting", game: undefined };

    expect(
      roomSounds({ previous: waiting, next: room({ game: { activePlayers: [ME] } }), hidden: true }),
    ).toEqual(["game-start"]);
  });
});

describe("roomRequests (CC-159)", () => {
  it("turns the opponent's open rematch request into a question with accept, decline and cancel", () => {
    const [asked] = incomingRequests(finished({ requests: [request()] }));

    expect(asked).toEqual({
      key: `rematch:${BOB}:${T}`,
      type: "rematch",
      from: BOB,
      to: ME,
      createdAt: T,
      expiresAt: T + 60_000,
      texts: REMATCH_TEXTS,
      accept: { type: "answer", requestType: "rematch", answer: "accept" },
      decline: { type: "answer", requestType: "rematch", answer: "decline" },
      cancel: { type: "answer", requestType: "rematch", answer: "withdraw" },
    });
    expect(asked.texts.question("Bob")).toBe("Bob wants a rematch.");
  });

  it("tells the viewer's own requests apart from the ones they were asked", () => {
    const mine = finished({ requests: [request({ from: ME, to: BOB })] });

    expect(outgoingRequests(mine).map((each) => each.from)).toEqual([ME]);
    expect(incomingRequests(mine)).toEqual([]);
  });

  it("lists only open requests, and none in rooms from before requests existed", () => {
    expect(roomRequests(finished({ requests: [ended("declined")] }))).toEqual([]);
    expect(roomRequests({ ...finished(), requests: undefined })).toEqual([]);
  });

  it("asks spectators nothing", () => {
    const watching = finished({ you: "", requests: [request()] });

    expect(incomingRequests(watching)).toEqual([]);
    expect(outgoingRequests(watching)).toEqual([]);
    expect(roomRequests(watching)).toHaveLength(1);
  });

  it.each(["constructor", "__proto__", "tostring", "hasOwnProperty"])(
    "words a request of kind %s, which every object inherits or nearly, as one nobody knows",
    (type) => {
      const texts = textsFor("chess", type);

      expect(texts.question("Bob")).toBe("Bob is asking you something.");
      expect(texts.site("Chess")).toBe("is asking you something at Chess");
    },
  );

  it("words a game's own requests through the registry, and a kind nobody knows plainly", () => {
    expect(textsFor("chess", "draw").question("Bob")).toBe("Bob offers a draw.");
    const unknown = textsFor("ludo", "truce");

    expect([
      unknown.title,
      unknown.question("Bob"),
      unknown.waiting("Bob"),
      unknown.declined("Bob"),
      unknown.withdrawn("Bob"),
      unknown.accepted("Bob"),
      unknown.site("Ludo"),
    ]).toEqual([
      "Request",
      "Bob is asking you something.",
      "Waiting for Bob to answer",
      "Bob said no",
      "Bob took the request back",
      "Bob said yes",
      "is asking you something at Ludo",
    ]);
    expect(REMATCH_TEXTS.waiting("Bob")).toBe("Waiting for Bob to answer your rematch request");
    expect(REMATCH_TEXTS.site("Chess")).toBe("wants a rematch at Chess");
  });
});

describe("requestAnswers (CC-160)", () => {
  const answered = (before, after, viewer = ME) =>
    requestAnswers(
      finished({ requests: [before], you: viewer }),
      finished({ requests: [after], you: viewer }),
    );

  it("tells the asker, in their words, how the other player answered", () => {
    const mine = request({ from: ME, to: BOB });

    expect(answered(mine, { ...mine, state: "declined", endedAt: T + 5 })).toEqual([
      {
        key: `rematch:${ME}:${T}`,
        type: "rematch",
        state: "declined",
        asked: true,
        otherId: BOB,
        message: "Bob declined the rematch",
      },
    ]);
    expect(answered(mine, { ...mine, state: "accepted" })[0].message).toBe(
      "Bob accepted. Starting the next game",
    );
    expect(answered(mine, { ...mine, state: "expired" })[0].message).toBe("No answer from Bob");
    expect(answered(mine, { ...mine, state: "withdrawn" })[0].message).toBe("You took the request back");
  });

  it("tells the player asked how it ended too", () => {
    const theirs = request();

    expect(answered(theirs, { ...theirs, state: "withdrawn" })[0]).toEqual(
      expect.objectContaining({ asked: false, otherId: BOB, message: "Bob took back the rematch request" }),
    );
    expect(answered(theirs, { ...theirs, state: "declined" })[0].message).toBe("You said no");
    expect(answered(theirs, { ...theirs, state: "accepted" })[0].message).toBe("You accepted");
    expect(answered(theirs, { ...theirs, state: "expired" })[0].message).toBe(
      "The request from Bob ran out of time",
    );
  });

  it("is news only once, and never across rooms, for spectators or for players it does not concern", () => {
    const theirs = request();
    const done = { ...theirs, state: "declined" };

    expect(answered(done, done)).toEqual([]);
    expect(answered(theirs, done, "")).toEqual([]);
    expect(
      answered(
        request({ from: "guest_x", to: "guest_y" }),
        ended("declined", { from: "guest_x", to: "guest_y" }),
      ),
    ).toEqual([]);
    expect(
      requestAnswers(finished({ requests: [theirs] }), finished({ code: "ZZZZZZ", requests: [done] })),
    ).toEqual([]);
  });

  it("uses the game's words for its own requests", () => {
    const offer = request({ type: "draw", from: ME, to: BOB });
    const before = chess({}, { requests: [offer] });

    expect(
      requestAnswers(before, chess({}, { requests: [{ ...offer, state: "declined" }] }))[0].message,
    ).toBe("Bob declined your draw offer");
  });
});

describe("roomNotices (CC-162, CC-207)", () => {
  it("tells the player still there that the opponent left the finished game, by name", () => {
    const before = finished();
    const gone = { available: false };

    expect(roomNotices(before, finished({ rematch: { ...gone, leftName: "Bobby" } }))).toEqual([
      "Bobby left the room",
    ]);
    expect(roomNotices(before, { ...finished({ rematch: gone }), seats: [before.seats[0]] })).toEqual([
      "Bob left the room",
    ]);
    expect(roomNotices(before, finished({ rematch: gone }))).toEqual(["Your opponent left the room"]);
  });

  it("says nothing more once a rematch is off, after a rematch started, for spectators, or before the game finished", () => {
    const gone = finished({ rematch: { available: false } });

    expect(roomNotices(gone, gone)).toEqual([]);
    expect(roomNotices(finished(), room({ game: { number: 2 } }))).toEqual([]);
    expect(roomNotices({ ...finished(), you: "" }, { ...gone, you: "" })).toEqual([]);
    expect(roomNotices(room(), finished())).toEqual([]);
    expect(roomNotices(finished(), { ...finished(), rematch: undefined })).toEqual([]);
    expect(roomNotices(finished(), finished({ code: "ZZZZZZ", rematch: { available: false } }))).toEqual([]);
  });
});
