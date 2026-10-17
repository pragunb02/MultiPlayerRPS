import { describe, expect, it } from "vitest";
import { incomingRequests, roomNotices, roomRequests, roomSounds } from "./roomUpdates.js";

const ME = "guest_me";
const BOB = "guest_bob";
const seats = [
  { playerId: ME, displayName: "Me", connected: true },
  { playerId: BOB, displayName: "Bob", connected: true },
];

/** A RoomView of a game the web app has no board for: only the room's own rules apply. */
const room = ({ game = {}, ...overrides } = {}) => ({
  code: "AB2CD3",
  gameId: "ludo",
  status: "playing",
  you: ME,
  seats,
  game: { view: {}, activePlayers: [BOB], outcome: { status: "ongoing" }, ...game },
  ...overrides,
});
const finished = ({ rematch = { requestedBy: [], available: true, declinedBy: "" }, ...overrides } = {}) =>
  room({
    status: "finished",
    rematch,
    series: { games: 1, wins: { [ME]: 1 } },
    game: { activePlayers: [], outcome: { status: "finished", result: "win", winners: [ME] } },
    ...overrides,
  });
const chess = (view = {}, overrides = {}) =>
  room({
    gameId: "chess",
    game: { view: { moves: [], drawOfferBy: "", drawAnswer: "", ...view }, activePlayers: [ME] },
    ...overrides,
  });

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
    const rematch = room({ series: { games: 1, wins: { [ME]: 1 } } });

    expect(roomSounds({ previous: waiting, next: room(), hidden: false })).toEqual(["game-start"]);
    expect(roomSounds({ previous: finished(), next: rematch, hidden: false })).toEqual(["game-start"]);
  });

  it("does not compare the new game's board with the last one", () => {
    const lastGame = chess(
      { moves: ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"] },
      { status: "finished" },
    );
    const rematch = chess({}, { series: { games: 1, wins: {} } });

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

  it("follows the deciding move with the viewer's result", () => {
    const win = { status: "finished", result: "win", winners: [ME] };
    const loss = { status: "finished", result: "win", winners: [BOB] };
    const draw = { status: "finished", result: "draw", winners: [] };
    const ended = (outcome) => room({ status: "finished", game: { outcome, activePlayers: [] } });

    expect(roomSounds({ previous: room(), next: ended(win), hidden: false })).toEqual(["win"]);
    expect(roomSounds({ previous: room(), next: ended(loss), hidden: false })).toEqual(["loss"]);
    expect(roomSounds({ previous: room(), next: ended(draw), hidden: false })).toEqual(["draw"]);
  });

  it("plays the checkmating move and then the win", () => {
    const before = chess({ moves: ["f3", "e5", "g4"] });
    const mated = {
      ...before,
      status: "finished",
      series: { games: 1, wins: { [ME]: 1 } },
      game: {
        view: { ...before.game.view, moves: ["f3", "e5", "g4", "Qh4#"] },
        activePlayers: [],
        outcome: { status: "finished", result: "win", winners: [ME] },
      },
    };

    expect(roomSounds({ previous: before, next: mated, hidden: false })).toEqual(["move", "win"]);
  });

  it("gives spectators and players without a seat no result sound", () => {
    const ended = room({
      status: "finished",
      game: { outcome: { status: "finished", result: "win", winners: [BOB] }, activePlayers: [] },
    });

    expect(roomSounds({ previous: room({ you: "" }), next: { ...ended, you: "" }, hidden: false })).toEqual(
      [],
    );
    expect(
      roomSounds({ previous: room({ you: "ghost" }), next: { ...ended, you: "ghost" }, hidden: false }),
    ).toEqual([]);
  });

  it("chimes once when someone asks you something", () => {
    const asked = finished({ rematch: { requestedBy: [BOB], available: true, declinedBy: "" } });

    expect(roomSounds({ previous: finished(), next: asked, hidden: false })).toEqual(["notify"]);
    expect(roomSounds({ previous: asked, next: { ...asked }, hidden: false })).toEqual([]);
  });

  it("chimes when your request is answered", () => {
    const asked = finished({ rematch: { requestedBy: [ME], available: true, declinedBy: "" } });
    const declined = finished({ rematch: { requestedBy: [], available: true, declinedBy: BOB } });

    expect(roomSounds({ previous: asked, next: declined, hidden: false })).toEqual(["notify"]);
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

describe("roomRequests (CC-104)", () => {
  it("turns the opponent's rematch request into a question with accept, decline and cancel", () => {
    const asked = finished({ rematch: { requestedBy: [BOB], available: true, declinedBy: "" } });

    const [request] = incomingRequests(asked);

    expect(request).toEqual(
      expect.objectContaining({
        key: `rematch:${BOB}`,
        from: BOB,
        title: "Rematch?",
        showWaiting: false,
        accept: { type: "rematch" },
        decline: { type: "decline-rematch" },
        cancel: { type: "rematch" },
      }),
    );
    expect(request.question("Bob")).toBe("Bob wants a rematch.");
    expect(request.waitingTitle).toBe("Rematch asked");
  });

  it("shows only your own request once you asked", () => {
    const both = finished({ rematch: { requestedBy: [BOB, ME], available: true, declinedBy: "" } });

    expect(roomRequests(both).map((request) => request.from)).toEqual([ME]);
    expect(incomingRequests(both)).toEqual([]);
  });

  it("has no rematch request during a game, after an opponent left, or in rooms without the rematch field", () => {
    const left = finished({ rematch: { requestedBy: [BOB], available: false, declinedBy: "" } });

    expect(roomRequests(room())).toEqual([]);
    expect(roomRequests(left)).toEqual([]);
    expect(roomRequests({ ...finished(), rematch: undefined })).toEqual([]);
  });

  it("adds the game's own requests, such as a chess draw offer", () => {
    expect(incomingRequests(chess({ drawOfferBy: BOB })).map((request) => request.key)).toEqual([
      `draw:${BOB}`,
    ]);
    expect(incomingRequests(chess({ drawOfferBy: ME }))).toEqual([]);
    expect(roomRequests(chess({ drawOfferBy: ME })).map((request) => request.from)).toEqual([ME]);
  });

  it("asks spectators nothing and has nothing before the game started", () => {
    const watching = finished({ you: "", rematch: { requestedBy: [BOB], available: true, declinedBy: "" } });

    expect(incomingRequests(watching)).toEqual([]);
    expect(roomRequests({ ...room(), status: "waiting", game: undefined })).toEqual([]);
  });
});

describe("roomNotices (CC-104)", () => {
  const rematch = (requestedBy, declinedBy = "") => ({ requestedBy, available: true, declinedBy });

  it("tells the asker who declined the rematch", () => {
    expect(
      roomNotices(finished({ rematch: rematch([ME]) }), finished({ rematch: rematch([], BOB) })),
    ).toEqual(["Bob declined the rematch"]);
  });

  it("tells the one asked that the request was taken back", () => {
    expect(roomNotices(finished({ rematch: rematch([BOB]) }), finished({ rematch: rematch([]) }))).toEqual([
      "Bob took back the rematch request",
    ]);
  });

  it("tells nobody about their own answer, or the same answer twice", () => {
    const declinedByMe = finished({ rematch: rematch([], ME) });

    expect(roomNotices(finished({ rematch: rematch([BOB]) }), declinedByMe)).toEqual([]);
    expect(roomNotices(finished({ rematch: rematch([ME]) }), finished({ rematch: rematch([ME]) }))).toEqual(
      [],
    );
    const declined = finished({ rematch: rematch([], BOB) });
    expect(roomNotices(declined, { ...declined })).toEqual([]);
  });

  it("tells the player still there that the opponent left the finished game, by name (CC-162)", () => {
    const asked = finished({ rematch: rematch([BOB]) });
    const gone = { requestedBy: [], available: false, declinedBy: "" };

    expect(roomNotices(asked, finished({ rematch: { ...gone, leftName: "Bobby" } }))).toEqual([
      "Bobby left the room",
    ]);
    expect(roomNotices(asked, { ...finished({ rematch: gone }), seats: [asked.seats[0]] })).toEqual([
      `${asked.seats[1].displayName} left the room`,
    ]);
    expect(roomNotices(asked, finished({ rematch: gone }))).toEqual(["Your opponent left the room"]);
  });

  it("says nothing more once a rematch is off, after a rematch started, for spectators, or before the game finished", () => {
    const asked = finished({ rematch: rematch([BOB]) });
    const gone = finished({ rematch: { requestedBy: [], available: false, declinedBy: "" } });

    expect(roomNotices(gone, gone)).toEqual([]);
    expect(roomNotices(asked, room({ series: { games: 1, wins: {} } }))).toEqual([]);
    expect(roomNotices({ ...asked, you: "" }, { ...finished(), you: "" })).toEqual([]);
    expect(roomNotices(room(), finished())).toEqual([]);
    expect(roomNotices(asked, { ...finished(), rematch: undefined })).toEqual([]);
  });

  it("reads rooms from a server that does not send who declined yet", () => {
    const old = (requestedBy) => finished({ rematch: { requestedBy, available: true } });

    expect(roomNotices(old([BOB]), old([]))).toEqual(["Bob took back the rematch request"]);
  });

  it("adds the game's own notices while the same game goes on", () => {
    const offered = chess({ drawOfferBy: ME });

    expect(roomNotices(offered, chess({ drawAnswer: "declined" }))).toEqual(["Bob declined your draw offer"]);
    expect(roomNotices(room(), room())).toEqual([]);
  });

  it("ignores updates from another room", () => {
    expect(
      roomNotices(
        finished({ rematch: rematch([ME]) }),
        finished({ code: "ZZZZZZ", rematch: rematch([], BOB) }),
      ),
    ).toEqual([]);
  });
});
