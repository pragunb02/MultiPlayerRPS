import { describe, expect, it } from "vitest";
import { chessNotices, chessRequests, chessSounds, soundForSan } from "./chessAlerts.js";

const ME = "guest_me";
const BOB = "guest_bob";
const seats = [
  { playerId: ME, displayName: "Me", connected: true },
  { playerId: BOB, displayName: "Bob", connected: true },
];
const chess = ({ status = "playing", you = ME, ...view } = {}) => ({
  code: "AB2CD3",
  gameId: "chess",
  status,
  you,
  seats,
  game: { view: { moves: [], drawOfferBy: "", drawAnswer: "", ...view }, activePlayers: [ME] },
});

describe("chess sounds (CC-103)", () => {
  it.each([
    ["e4", "move"],
    ["Nf3", "move"],
    ["exd5", "capture"],
    ["Qxf7+", "check"],
    ["Bb5+", "check"],
    ["O-O", "castle"],
    ["O-O-O", "castle"],
    ["O-O+", "check"],
    ["Qxf7#", "capture"],
    ["e8=Q", "move"],
  ])("plays %s as a %s", (san, sound) => {
    expect(soundForSan(san)).toBe(sound);
  });

  it("plays the newest move's sound when a move was made, and nothing otherwise", () => {
    const before = chess({ moves: ["e4"] });

    expect(chessSounds(before, chess({ moves: ["e4", "exd5"] }))).toEqual(["capture"]);
    expect(chessSounds(before, chess({ moves: ["e4"], drawOfferBy: BOB }))).toEqual([]);
  });
});

describe("chess draw offers as requests (CC-104)", () => {
  it("turns a standing offer into a request with accept, decline and withdraw moves", () => {
    const [request] = chessRequests(chess({ drawOfferBy: BOB }));

    expect(request).toEqual(
      expect.objectContaining({
        key: `draw:${BOB}`,
        from: BOB,
        title: "Draw offer",
        waitingTitle: "Draw offered",
        showWaiting: true,
        accept: { type: "move", move: { type: "accept-draw" } },
        decline: { type: "move", move: { type: "decline-draw" } },
        cancel: { type: "move", move: { type: "withdraw-draw" } },
      }),
    );
    expect(request.question("Bob")).toBe("Bob offers a draw.");
  });

  it("has no request without an offer or once the game is over", () => {
    expect(chessRequests(chess())).toEqual([]);
    expect(chessRequests(chess({ status: "finished", drawOfferBy: BOB }))).toEqual([]);
  });
});

describe("chess draw answers (CC-104)", () => {
  it("tells the offerer that the opponent declined, also by simply moving", () => {
    const offered = chess({ drawOfferBy: ME });

    expect(chessNotices(offered, chess({ drawAnswer: "declined" }), ME)).toEqual([
      "Bob declined your draw offer",
    ]);
  });

  it("tells the opponent that the offer was withdrawn", () => {
    const offered = chess({ drawOfferBy: BOB });

    expect(chessNotices(offered, chess({ drawAnswer: "withdrawn" }), ME)).toEqual([
      "Bob withdrew the draw offer",
    ]);
  });

  it("tells nobody about their own answer", () => {
    expect(chessNotices(chess({ drawOfferBy: BOB }), chess({ drawAnswer: "declined" }), ME)).toEqual([]);
    expect(chessNotices(chess({ drawOfferBy: ME }), chess({ drawAnswer: "withdrawn" }), ME)).toEqual([]);
  });

  it("says nothing to spectators, after an accepted draw, while the offer stands, or with no offer before", () => {
    const offered = chess({ drawOfferBy: ME });
    const declined = chess({ drawAnswer: "declined" });

    expect(chessNotices(offered, declined, "")).toEqual([]);
    expect(chessNotices(offered, chess({ status: "finished" }), ME)).toEqual([]);
    expect(chessNotices(offered, chess({ drawOfferBy: ME, moves: ["e4"] }), ME)).toEqual([]);
    expect(chessNotices(chess(), declined, ME)).toEqual([]);
    expect(chessNotices(offered, chess(), ME)).toEqual([]);
  });
});
