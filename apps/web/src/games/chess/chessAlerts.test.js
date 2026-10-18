import { describe, expect, it } from "vitest";
import { CHESS_REQUEST_TEXTS, chessReasonPhrase, chessSounds, soundForSan } from "./chessAlerts.js";

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
  game: { view: { moves: [], ...view }, activePlayers: [ME] },
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
    expect(chessSounds(before, chess({ moves: ["e4"] }))).toEqual([]);
  });
});

describe("chess draw offers as room requests (CC-159)", () => {
  it("words the offer for both players and every way it can end", () => {
    const draw = CHESS_REQUEST_TEXTS.draw;

    expect([
      draw.title,
      draw.question("Bob"),
      draw.waiting("Bob"),
      draw.declined("Bob"),
      draw.withdrawn("Bob"),
      draw.accepted("Bob"),
      draw.site("Chess"),
    ]).toEqual([
      "Draw offer",
      "Bob offers a draw.",
      "Draw offered. Waiting for Bob to answer",
      "Bob declined your draw offer",
      "Bob withdrew the draw offer",
      "Bob accepted the draw",
      "offers a draw at Chess",
    ]);
  });
});

describe("chess end reasons (CC-162)", () => {
  it("words every way a game ends, and nothing for a reason it does not know", () => {
    expect(chessReasonPhrase("agreement")).toBe("by agreement");
    expect(chessReasonPhrase("nonsense")).toBe("");
  });
});
