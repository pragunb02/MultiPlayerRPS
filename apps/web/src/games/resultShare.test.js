import { describe, expect, it } from "vitest";
import { GAMES, ROOM_END_REASONS } from "@classicade/shared";
import { resultText } from "../lib/shareText.js";
import { resultShare, resultShareOf } from "./resultShare.js";

const ORIGIN = "https://classicade.example";

// The three kinds of player a share must never name (ADR-028.7): a guest, an account of unknown age (a minor until
// CC-152) and an adult. Each carries everything personal a seat could ever hold, so the test can look for all of it.
const AUDIENCES = Object.freeze({
  guest: { playerId: "guest_7kx2abcd9q", displayName: "Guest-7KX2", email: "", kind: "guest" },
  minor: {
    playerId: "u_64f0c0ffee01",
    displayName: "kabir_2012",
    email: "kabir.k@example.com",
    kind: "account",
  },
  adult: {
    playerId: "u_64f0adul7001",
    displayName: "Riya Sharma",
    email: "riya.s@example.com",
    kind: "account",
    birthYear: 1990,
  },
});
const OPPONENT = Object.freeze({
  playerId: "u_64f0bbbbbb02",
  displayName: "Bob The Builder",
  email: "bob@example.com",
  kind: "account",
});
const CHARACTER = Object.freeze({ rps: "rocky", tictactoe: "pip", chess: "queen-vee" });
const CODE = "AB2CD3";

const seat = (player) => ({ ...player, connected: true, presence: "here", graceUntil: 0 });
const botSeat = (gameId) => ({
  playerId: `bot_${CHARACTER[gameId]}_easy`,
  displayName: "Robo Name From The Server",
  connected: true,
  bot: { character: CHARACTER[gameId], level: "easy" },
});

/** A finished RoomView from the viewer's seat. */
function finishedRoom({ gameId, viewer, against, outcome, series }) {
  const opponent = against === "character" ? botSeat(gameId) : seat(OPPONENT);
  const you = viewer.playerId;
  const winners = { win: [you], loss: [opponent.playerId], forfeit: [you], draw: [], aborted: [] }[outcome];
  const result = { draw: "draw", aborted: "aborted" }[outcome] ?? "win";
  const reason = outcome === "forfeit" ? ROOM_END_REASONS.FORFEIT : "";
  return {
    code: CODE,
    gameId,
    status: "finished",
    hostId: you,
    players: { min: 2, max: 2 },
    seats: [seat(viewer), opponent],
    you,
    requests: [],
    series,
    game: {
      view: {},
      activePlayers: [],
      outcome: { status: "finished", result, winners, reason },
      number: 1,
    },
  };
}

/** Everything personal or private a room holds: names, ids, emails and the room's code. */
const secretsOf = (room) =>
  [CODE, ...room.seats.flatMap((entry) => [entry.displayName, entry.playerId, entry.email])].filter(
    (value) => typeof value === "string" && value !== "",
  );

const OUTCOMES = ["win", "loss", "draw", "forfeit", "aborted"];
const CASES = GAMES.flatMap((game) =>
  Object.keys(AUDIENCES).flatMap((audience) =>
    ["person", "character"].flatMap((against) =>
      OUTCOMES.map((outcome) => [game.id, audience, against, outcome]),
    ),
  ),
);

describe("resultShare", () => {
  it.each(CASES)(
    "%s, viewer %s against a %s, %s: no name, id, email or room code",
    (gameId, audience, against, outcome) => {
      const viewer = AUDIENCES[audience];
      const room = finishedRoom({
        gameId,
        viewer,
        against,
        outcome,
        series: { games: 3, wins: { [viewer.playerId]: 2 } },
      });

      const share = resultShare(room, { origin: ORIGIN });

      for (const secret of secretsOf(room)) {
        expect(share.message).not.toContain(secret);
        expect(decodeURIComponent(share.whatsapp)).not.toContain(secret);
      }
      expect(share.message).not.toMatch(/@|u_|guest_|bot_/);
    },
  );

  it.each(GAMES)("links to the $name page on the site's own address, never the room", (game) => {
    const room = finishedRoom({
      gameId: game.id,
      viewer: AUDIENCES.guest,
      against: "person",
      outcome: "win",
    });

    const share = resultShare(room, { origin: ORIGIN });

    expect(share.url).toBe(`${ORIGIN}/games/${game.slug}`);
    expect(share.message.endsWith(`\n${share.url}`)).toBe(true);
    expect(share.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(share.message)}`);
  });

  it("is the same text for a guest, a minor and an adult in the same game", () => {
    const texts = Object.values(AUDIENCES).map(
      (viewer) =>
        resultShare(finishedRoom({ gameId: "rps", viewer, against: "character", outcome: "win" }), {
          origin: ORIGIN,
        }).message,
    );

    expect(new Set(texts).size).toBe(1);
  });
});

describe("resultShareOf", () => {
  const viewer = AUDIENCES.adult;

  it("names the character from the catalogue, never from the seat", () => {
    const room = finishedRoom({ gameId: "rps", viewer, against: "character", outcome: "loss" });

    expect(resultShareOf(room)).toEqual({
      gameId: "rps",
      outcome: "loss",
      character: "Rocky",
      score: "",
      forfeit: false,
    });
  });

  it("gives the series score as numbers only, once more than one game was played", () => {
    const series = { games: 3, wins: { [viewer.playerId]: 2, [OPPONENT.playerId]: 1 } };
    const room = finishedRoom({ gameId: "chess", viewer, against: "person", outcome: "win", series });

    expect(resultShareOf(room)).toMatchObject({ character: "", score: "2-1" });
    expect(resultShareOf({ ...room, series: { games: 1, wins: { [viewer.playerId]: 1 } } }).score).toBe("");
    expect(resultShareOf({ ...room, series: undefined }).score).toBe("");
  });

  it("gives the rounds of a best of 3 when only one game was played, like a Wordle score", () => {
    const room = finishedRoom({ gameId: "rps", viewer, against: "character", outcome: "win" });
    const rocky = room.seats[1].playerId;
    const withRounds = (score) => ({ ...room, game: { ...room.game, view: { bestOf: 3, score } } });

    expect(resultShareOf(withRounds({ [viewer.playerId]: 2, [rocky]: 1 })).score).toBe("2-1");
    expect(resultShareOf(withRounds({ [viewer.playerId]: 2 })).score).toBe("2-0");
    expect(resultShareOf(withRounds({ [viewer.playerId]: 1 })).score).toBe("");
    expect(resultText(resultShareOf(withRounds({ [viewer.playerId]: 2, [rocky]: 1 })))).toBe(
      "🏆 I beat Rocky 2-1 at Rock Paper Scissors on ClassiCade. Can you beat Rocky?",
    );
  });

  it("tells a forfeit, a draw and an aborted game apart", () => {
    const of = (outcome) =>
      resultShareOf(finishedRoom({ gameId: "chess", viewer, against: "person", outcome }));

    expect(of("forfeit")).toMatchObject({ outcome: "win", forfeit: true });
    expect(of("draw")).toMatchObject({ outcome: "draw", forfeit: false });
    expect(of("aborted")).toMatchObject({ outcome: "neutral" });
  });

  it("has no result to tell a spectator", () => {
    const room = finishedRoom({ gameId: "chess", viewer, against: "person", outcome: "win" });

    expect(resultShareOf({ ...room, you: "" }).outcome).toBe("neutral");
  });

  it("still tells the result when the opponent's seat is gone after they left", () => {
    const series = { games: 2, wins: { [viewer.playerId]: 2 } };
    const room = finishedRoom({ gameId: "chess", viewer, against: "person", outcome: "forfeit", series });

    expect(resultShareOf({ ...room, seats: [room.seats[0]] })).toEqual({
      gameId: "chess",
      outcome: "win",
      character: "",
      score: "2-0",
      forfeit: true,
    });
  });

  it("knows no character for a computer player this build has never heard of", () => {
    const room = finishedRoom({ gameId: "chess", viewer, against: "character", outcome: "win" });
    const seats = [room.seats[0], { ...room.seats[1], bot: { character: "nobody", level: "easy" } }];

    expect(resultShareOf({ ...room, seats }).character).toBe("");
  });
});
