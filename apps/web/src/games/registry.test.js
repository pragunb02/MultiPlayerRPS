import { describe, expect, it } from "vitest";
import { GAME_IDS } from "@classicade/shared";
import { GAME_VIEWS, gameView } from "./registry.js";
import { describeGameViewContract } from "./testing/gameViewContract.js";

const T = 7_000_000;
const seats = [
  { playerId: "guest_me", displayName: "Me", connected: true, presence: "here", graceUntil: 0 },
  { playerId: "guest_them", displayName: "Riya", connected: true, presence: "here", graceUntil: 0 },
];
const request = (from, to) => ({
  type: "draw",
  from,
  to,
  createdAt: T,
  expiresAt: T + 30_000,
  state: "open",
  endedAt: 0,
});

/** A game that is on, seen from a seat, with no request, one asked of the viewer and one the viewer asked. */
const roomsFor = (gameId) => {
  const base = {
    code: "AB2CD3",
    gameId,
    status: "playing",
    hostId: "guest_me",
    players: { min: 2, max: 2 },
    seats,
    you: "guest_me",
    requests: [],
    serverTime: T,
    game: { view: {}, activePlayers: ["guest_me"], outcome: { status: "ongoing" }, number: 1 },
  };
  return {
    "a game that is on": base,
    "a request asked of the viewer": { ...base, requests: [request("guest_them", "guest_me")] },
    "a request the viewer asked": { ...base, requests: [request("guest_me", "guest_them")] },
  };
};

for (const [gameId, entry] of Object.entries(GAME_VIEWS)) {
  describeGameViewContract(gameId, { entry, rooms: roomsFor(gameId) });
}

describe("gameView", () => {
  it("gives every game in the registry its entry", () => {
    expect(gameView(GAME_IDS.CHESS)).toBe(GAME_VIEWS[GAME_IDS.CHESS]);
  });

  it("gives an empty entry for a game the web app has nothing for yet", () => {
    expect(gameView("ludo")).toEqual({});
    expect(Object.isFrozen(gameView("ludo"))).toBe(true);
  });
});
