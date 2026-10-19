import { describe, expect, it } from "vitest";
import { SOUNDS } from "../lib/sound/sounds.js";
import { ENDINGS, momentAnnouncement, outcomeMoment, TONES } from "./outcomeMoment.js";
import { GAME_VIEWS } from "./registry.js";

const ALICE = { playerId: "a", displayName: "Alice", connected: true };
const BOB = { playerId: "b", displayName: "Bob", connected: true };

/** A finished RoomView of `gameId`, seen by `you` ("" for a spectator). */
const finished = (gameId, outcome, { you = "a", seats = [ALICE, BOB], rematch } = {}) => ({
  gameId,
  you,
  status: "finished",
  seats,
  ...(rematch === undefined ? {} : { rematch }),
  game: { view: {}, activePlayers: [], outcome },
});
const win = (winner, reason) => ({ status: "finished", result: "win", winners: [winner], reason });
const draw = (reason) => ({ status: "finished", result: "draw", winners: [], reason });
const ABORTED = Object.freeze({ status: "finished", result: "aborted", winners: [], reason: "aborted" });

/** A computer character in Bob's seat. */
const computer = (character, level) => ({ ...BOB, displayName: character, bot: { character, level } });

const CHESS_DRAWS = [
  "stalemate",
  "insufficient-material",
  "threefold-repetition",
  "fifty-move-rule",
  "agreement",
  "timeout-vs-insufficient-material",
];

describe("outcomeMoment: every ending of every game, for the winner, the loser and a spectator (CC-163)", () => {
  // [game, outcome, viewer, ending, headline, English line, sound]
  const TABLE = [
    ["chess", win("a", "checkmate"), "a", "won", "You won by checkmate", "Clean finish.", SOUNDS.WIN],
    [
      "chess",
      win("b", "checkmate"),
      "a",
      "lost",
      "You lost by checkmate",
      "Good game. Want another?",
      SOUNDS.LOSS,
    ],
    ["chess", win("b", "checkmate"), "", "watched", "Bob won by checkmate", "What a match.", ""],
    ["chess", win("a", "resignation"), "a", "won", "You won by resignation", "Bob resigned.", SOUNDS.WIN],
    ["chess", win("b", "resignation"), "a", "lost", "You lost by resignation", "Fresh board?", SOUNDS.LOSS],
    ["chess", win("a", "resignation"), "", "watched", "Alice won by resignation", "Bob resigned.", ""],
    ["chess", win("a", "timeout"), "a", "won", "You won on time", "Bob's clock ran out.", SOUNDS.WIN],
    [
      "chess",
      win("b", "timeout"),
      "a",
      "lost",
      "You lost on time",
      "Close one. Try a longer clock next.",
      SOUNDS.LOSS,
    ],
    ["chess", win("b", "timeout"), "", "watched", "Bob won on time", "Alice's clock ran out.", ""],
    ["chess", draw("stalemate"), "a", "drew", "Draw by stalemate", "Nobody could win that one.", SOUNDS.DRAW],
    [
      "chess",
      draw("agreement"),
      "b",
      "drew",
      "Draw by agreement",
      "Both players agreed on a draw.",
      SOUNDS.DRAW,
    ],
    ["chess", draw("agreement"), "", "drew", "Draw by agreement", "Both players agreed on a draw.", ""],
    [
      "chess",
      draw("timeout-vs-insufficient-material"),
      "a",
      "drew",
      "Draw on time with too little material to win",
      "Time ran out, but no mate was possible.",
      SOUNDS.DRAW,
    ],
    [
      "tictactoe",
      win("a", "three-in-a-row"),
      "a",
      "won",
      "You won with three in a row",
      "Nice line.",
      SOUNDS.WIN,
    ],
    [
      "tictactoe",
      win("b", "three-in-a-row"),
      "a",
      "lost",
      "You lost to three in a row",
      "They got three first. Watch their lines.",
      SOUNDS.LOSS,
    ],
    [
      "tictactoe",
      win("b", "three-in-a-row"),
      "",
      "watched",
      "Bob won with three in a row",
      "What a match.",
      "",
    ],
    [
      "tictactoe",
      draw("board-full"),
      "a",
      "drew",
      "Draw with a full board",
      "Perfect play from both sides.",
      SOUNDS.DRAW,
    ],
    ["rps", win("a", "best-of-3"), "a", "won", "You won the best of 3", "You read them.", SOUNDS.WIN],
    [
      "rps",
      win("b", "best-of-5"),
      "a",
      "lost",
      "You lost the best of 5",
      "Good game. Want another?",
      SOUNDS.LOSS,
    ],
    ["rps", win("a", "best-of-1"), "", "watched", "Alice won the best of 1", "What a match.", ""],
    [
      "rps",
      win("a", "forfeit"),
      "a",
      "won-quietly",
      "You won by forfeit",
      "Bob left the game.",
      SOUNDS.WIN_QUIET,
    ],
    [
      "chess",
      win("b", "forfeit"),
      "a",
      "lost",
      "You lost by forfeit",
      "The game ended while you were away.",
      SOUNDS.LOSS,
    ],
    ["tictactoe", win("b", "forfeit"), "", "watched", "Bob won by forfeit", "Alice left the game.", ""],
    [
      "tictactoe",
      win("a", "idle"),
      "a",
      "won-quietly",
      "You won on the move timer",
      "Bob didn't move in time.",
      SOUNDS.WIN_QUIET,
    ],
    [
      "chess",
      win("b", "idle"),
      "a",
      "lost",
      "You lost on the move timer",
      "The move timer ran out.",
      SOUNDS.LOSS,
    ],
    ["rps", win("b", "idle"), "", "watched", "Bob won on the move timer", "Alice didn't move in time.", ""],
    ["rps", draw("idle"), "a", "drew", "Draw on the move timer", "Neither move came in time.", SOUNDS.DRAW],
    [
      "chess",
      ABORTED,
      "a",
      "aborted",
      "Game aborted",
      "No first move in time. Nothing counted.",
      SOUNDS.GAME_VOID,
    ],
    [
      "rps",
      ABORTED,
      "b",
      "aborted",
      "Game aborted",
      "No first move in time. Nothing counted.",
      SOUNDS.GAME_VOID,
    ],
    ["tictactoe", ABORTED, "", "aborted", "Game aborted", "No first move in time. Nothing counted.", ""],
  ];

  it.each(TABLE)("%s %o seen by %j: %s, %j", (gameId, outcome, you, ending, headline, english, sound) => {
    const moment = outcomeMoment(finished(gameId, outcome, { you }));

    expect(moment.ending).toBe(ending);
    expect(moment.tone).toBe(ENDINGS[ending].tone);
    expect(moment.headline).toBe(headline);
    expect(moment.line.english).toBe(english);
    expect(moment.line.hinglish).not.toBe("");
    expect(moment.sound).toBe(sound);
  });

  it.each(CHESS_DRAWS)("words the chess draw %s for both players and a spectator", (reason) => {
    for (const you of ["a", "b", ""]) {
      const moment = outcomeMoment(finished("chess", draw(reason), { you }));
      expect(moment.ending).toBe("drew");
      expect(moment.headline).toMatch(/^Draw (by|on) /);
      expect(moment.line.english).not.toBe("");
    }
  });

  it("keeps the plain result and kind plain lines for a reason or a game this version does not know", () => {
    expect(outcomeMoment(finished("chess", win("a", "meteor")))).toMatchObject({
      ending: "won",
      headline: "You won!",
      line: { english: "Well played." },
    });
    expect(outcomeMoment(finished("ludo", win("b", "home-run")))).toMatchObject({
      ending: "lost",
      headline: "You lost",
      line: { english: "Good game. Want another?" },
    });
    expect(outcomeMoment(finished("ludo", draw("tie")))).toMatchObject({
      ending: "drew",
      line: { english: "An even game." },
    });
    expect(outcomeMoment(finished("ludo", win("b", "home-run"), { you: "" }))).toMatchObject({
      ending: "watched",
      line: { english: "What a match." },
    });
  });

  it("never reads a reason from what every object inherits", () => {
    expect(outcomeMoment(finished("chess", win("a", "constructor"))).line.english).toBe("Well played.");
    expect(outcomeMoment(finished("tictactoe", win("a", "toString"))).line.english).toBe("Well played.");
  });

  it("names the opponent who left from the room's memory once their seat is gone", () => {
    const moment = outcomeMoment(
      finished("chess", win("a", "forfeit"), {
        seats: [ALICE],
        rematch: { available: false, leftName: "Bob" },
      }),
    );
    expect(moment.line.english).toBe("Bob left the game.");
    expect(
      outcomeMoment(finished("chess", win("a", "forfeit"), { seats: [ALICE], rematch: { available: false } }))
        .line.english,
    ).toBe("Your opponent left the game.");
  });
});

describe("outcomeMoment: tones, stamps and effects", () => {
  it("celebrates a win played to the end with gold, the stamp and confetti", () => {
    expect(outcomeMoment(finished("chess", win("a", "checkmate")))).toMatchObject({
      tone: TONES.WIN,
      stamp: "Victory!",
      effect: "confetti",
      icon: "",
    });
  });

  it.each(["forfeit", "idle"])("keeps a win by %s quiet: gold and a trophy, never confetti", (reason) => {
    expect(outcomeMoment(finished("rps", win("a", reason)))).toMatchObject({
      tone: TONES.QUIET_WIN,
      stamp: "Victory",
      effect: "none",
      icon: "trophy",
      sound: SOUNDS.WIN_QUIET,
    });
  });

  it("meets a loss gently: no stamp, the board dims, the soft loss sound", () => {
    expect(outcomeMoment(finished("tictactoe", win("b", "three-in-a-row")))).toMatchObject({
      tone: TONES.GENTLE_LOSS,
      stamp: "",
      effect: "dim",
      sound: SOUNDS.LOSS,
    });
  });

  it("keeps a draw, an aborted game and a spectator's view even, with no effect", () => {
    expect(outcomeMoment(finished("chess", draw("stalemate")))).toMatchObject({
      tone: TONES.EVEN,
      stamp: "Draw",
      effect: "none",
    });
    expect(outcomeMoment(finished("chess", ABORTED))).toMatchObject({
      tone: TONES.EVEN,
      stamp: "No result",
      effect: "none",
    });
    expect(outcomeMoment(finished("chess", win("a", "checkmate"), { you: "" }))).toMatchObject({
      tone: TONES.EVEN,
      stamp: "Game over",
      effect: "none",
      sound: "",
    });
  });

  it("gives a seated player who has no seat any more (a spectator's view) no sound", () => {
    expect(outcomeMoment(finished("chess", win("b", "checkmate"), { you: "c" })).sound).toBe("");
  });

  it("returns a frozen moment", () => {
    const moment = outcomeMoment(finished("chess", win("a", "checkmate")));
    expect(Object.isFrozen(moment)).toBe(true);
    expect(Object.isFrozen(moment.line)).toBe(true);
  });
});

describe("outcomeMoment: a computer character's tip after a loss", () => {
  it.each([
    ["rps", "rocky", "hard", "best-of-3", "Rocky read that one. Try mixing it up."],
    ["rps", "rocky", "easy", "best-of-3", "Rocky throws at random. Go again?"],
    ["tictactoe", "pip", "hard", "three-in-a-row", "Pip never loses. A draw is a win."],
    ["tictactoe", "pip", "medium", "three-in-a-row", "Pip loves a corner. Take one first."],
    ["chess", "queen-vee", "easy", "checkmate", "Queen Vee attacks first. Guard your pieces."],
  ])("%s against %s (%s) says the character's habit", (gameId, character, level, reason, english) => {
    const room = finished(gameId, win("b", reason), { seats: [ALICE, computer(character, level)] });
    expect(outcomeMoment(room).line.english).toBe(english);
  });

  it("keeps the room's own words when the loss was a forfeit or the move timer", () => {
    const seats = [ALICE, computer("rocky", "hard")];
    expect(outcomeMoment(finished("rps", win("b", "idle"), { seats })).line.english).toBe(
      "The move timer ran out.",
    );
  });

  it("keeps the game's words for a character this version does not know", () => {
    const seats = [ALICE, computer("zed", "hard")];
    expect(outcomeMoment(finished("rps", win("b", "best-of-3"), { seats })).line.english).toBe(
      "Good game. Want another?",
    );
  });

  it("says nothing about a character when the player won", () => {
    const seats = [ALICE, computer("rocky", "hard")];
    expect(outcomeMoment(finished("rps", win("a", "best-of-3"), { seats })).line.english).toBe(
      "You read them.",
    );
  });
});

/** Every line any ending can show: each game's reasons and hints, the room's reasons and the plain lines. */
function everyLine() {
  const rooms = [];
  const games = {
    chess: ["checkmate", "resignation", "timeout", ...CHESS_DRAWS],
    tictactoe: ["three-in-a-row", "board-full"],
    rps: ["best-of-3"],
  };
  const characters = {
    rps: ["rocky", ["easy", "hard"]],
    tictactoe: ["pip", ["easy", "medium", "hard"]],
    chess: ["queen-vee", ["easy", "medium", "hard"]],
  };
  for (const [gameId, reasons] of Object.entries({ ...games, ludo: ["home-run"] })) {
    for (const reason of [...reasons, "forfeit", "idle"]) {
      for (const you of ["a", "b", ""]) {
        rooms.push(finished(gameId, win("a", reason), { you }), finished(gameId, draw(reason), { you }));
      }
    }
    rooms.push(finished(gameId, ABORTED));
  }
  for (const [gameId, [character, levels]] of Object.entries(characters)) {
    for (const level of levels) {
      rooms.push(
        finished(gameId, win("b", games[gameId][0]), { seats: [ALICE, computer(character, level)] }),
      );
    }
  }
  return rooms.map((room) => outcomeMoment(room));
}

describe("the words follow the copy rules (ADR-050 point 2)", () => {
  const DENYLIST =
    /\b(gave up|give up|too slow|easy|noob|loser|bad|failed|fail|should have|bekaar|haar gaya|haar gayi)\b/i;
  const words = (text) => text.split(/\s+/).filter(Boolean).length;

  it("keeps every line to 8 words or fewer in each language", () => {
    for (const { line } of everyLine()) {
      expect(words(line.english), line.english).toBeLessThanOrEqual(8);
      expect(words(line.hinglish), line.hinglish).toBeLessThanOrEqual(8);
    }
  });

  it("never shouts or shames after a loss", () => {
    const losses = everyLine().filter((moment) => moment.ending === "lost");
    expect(losses.length).toBeGreaterThan(10);
    for (const { headline, line } of losses) {
      for (const text of [headline, line.english, line.hinglish]) {
        expect(text).not.toContain("!");
        expect(text).not.toMatch(DENYLIST);
      }
    }
  });

  it("never uses a shaming word anywhere", () => {
    for (const { line } of everyLine()) {
      expect(line.english).not.toMatch(DENYLIST);
      expect(line.hinglish).not.toMatch(DENYLIST);
    }
  });

  it("gives every game in the registry outcome words, so a reason it adds is worded by addition", () => {
    for (const entry of Object.values(GAME_VIEWS)) {
      expect(typeof entry.outcomeText.words).toBe("function");
    }
  });
});

describe("momentAnnouncement: what the screen reader hears", () => {
  it("reads the headline, then the Hinglish and the English line, as the card shows them", () => {
    const moment = outcomeMoment(finished("chess", win("b", "checkmate")));
    expect(momentAnnouncement(moment)).toBe(
      `You lost by checkmate. ${moment.line.hinglish} Good game. Want another?`,
    );
  });

  it("does not add a full stop after a headline that already ends a sentence", () => {
    const moment = outcomeMoment(finished("chess", win("a", "meteor")));
    expect(momentAnnouncement(moment)).toBe(`You won! ${moment.line.hinglish} Well played.`);
  });
});
