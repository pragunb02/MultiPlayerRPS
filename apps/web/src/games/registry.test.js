import { describe, expect, it } from "vitest";
import { GAME_IDS, GAMES } from "@classicade/shared";
import { gameLeadFor, HOW_TO_PLAY_LIMITS, howToPlayFor, stepCount } from "./howToPlay.js";
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

describe("pass and play in the registry (CC-223)", () => {
  it.each(Object.values(GAME_IDS))("loads the pure engine of %s on demand", async (gameId) => {
    const engine = await GAME_VIEWS[gameId].passAndPlay.loadEngine();

    expect(engine.id).toBe(gameId);
  });

  it("covers the board between turns only in the game that keeps a move secret", () => {
    const handOver = Object.fromEntries(
      Object.entries(GAME_VIEWS).map(([gameId, entry]) => [gameId, entry.passAndPlay.handOver]),
    );

    expect(handOver).toEqual({
      [GAME_IDS.RPS]: true,
      [GAME_IDS.TIC_TAC_TOE]: false,
      [GAME_IDS.CHESS]: false,
    });
  });
});

// Check A2 of the clarity audit (CC-348, CC-349): every game a player can open has How to play, short enough to read
// at a glance in the lobby, on an invite and in the game's dialog.
describe("How to play on every game (A2, CC-349)", () => {
  it.each(GAMES.map((game) => [game.name, game.id]))("gives %s 1 to 3 short steps", async (_name, gameId) => {
    const steps = (await gameView(gameId).loadHowToPlay?.()) ?? [];

    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps.length).toBeLessThanOrEqual(HOW_TO_PLAY_LIMITS.steps);
    for (const { text, hinglish } of steps) {
      expect(text.length, text).toBeLessThan(HOW_TO_PLAY_LIMITS.characters);
      expect(text).toMatch(/^[A-Z].*\.$/);
      // The Hinglish twin says the same with "tum", never "aap" (C9, CC-217).
      expect(hinglish.length, hinglish).toBeLessThan(HOW_TO_PLAY_LIMITS.characters);
      expect(hinglish).toMatch(/^[A-Z].*\.$/);
      expect(hinglish).not.toMatch(/\b(aap|aapka|aapke|aapko|kijiye|karein|dijiye)\b/i);
    }
  });

  it.each(Object.keys(GAME_VIEWS))("gives the pages the registry's steps for %s", async (gameId) => {
    expect(howToPlayFor(gameId)).toBe(await GAME_VIEWS[gameId].loadHowToPlay());
  });

  it("allows three steps of under 90 characters", () => {
    expect(HOW_TO_PLAY_LIMITS).toEqual({ steps: 3, characters: 90 });
  });

  it("gives no steps and no lobby line for a game the web app has nothing for yet", () => {
    expect(howToPlayFor("ludo")).toEqual([]);
    expect(gameLeadFor("ludo")).toBe("");
  });

  it("counts the steps in plain words", () => {
    expect(stepCount([1, 2, 3])).toBe("3 steps");
    expect(stepCount([1])).toBe("1 step");
  });
});

describe("gameView", () => {
  it("gives every game in the registry its entry", () => {
    expect(gameView(GAME_IDS.CHESS)).toBe(GAME_VIEWS[GAME_IDS.CHESS]);
  });

  it("gives an empty entry for a game the web app has nothing for yet", () => {
    expect(gameView("ludo")).toEqual({});
    expect(Object.isFrozen(gameView("ludo"))).toBe(true);
  });
});
