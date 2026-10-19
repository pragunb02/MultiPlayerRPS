import { describe, expect, it } from "vitest";
import { GAMES } from "@classicade/shared";
import { inviteText, RESULT_OUTCOMES, resultText, shareMessage, whatsappUrl } from "./shareText.js";

const URL_ = "https://classicade.example/games/chess";
const result = (fields = {}) => ({
  gameId: "chess",
  outcome: "win",
  character: "",
  score: "",
  forfeit: false,
  ...fields,
});

describe("resultText", () => {
  it("says the player beat the character, with the series score, like a Wordle result", () => {
    expect(resultText(result({ gameId: "rps", character: "Rocky", score: "2-1" }))).toBe(
      "🏆 I beat Rocky 2-1 at Rock Paper Scissors on ClassiCade. Can you beat Rocky?",
    );
  });

  it("says the player won against a person, without naming the person", () => {
    expect(resultText(result({ score: "3-2" }))).toBe("🏆 I won 3-2 at Chess on ClassiCade. Your turn!");
    expect(resultText(result())).toBe("🏆 I won a game of Chess on ClassiCade. Your turn!");
  });

  it("says a win by forfeit quietly", () => {
    expect(resultText(result({ forfeit: true }))).toBe(
      "🏆 I won a game of Chess on ClassiCade (my opponent left). Your turn!",
    );
  });

  it("owns up to a loss kindly, and dares the friend", () => {
    expect(resultText(result({ gameId: "tictactoe", outcome: "loss", character: "Pip" }))).toBe(
      "🎯 Pip beat me at Tic Tac Toe on ClassiCade. Can you beat Pip?",
    );
    expect(resultText(result({ outcome: "loss" }))).toBe(
      "🎯 I played Chess on ClassiCade and lost. Can you do better?",
    );
  });

  it("calls a draw a draw", () => {
    expect(resultText(result({ outcome: "draw", character: "Queen Vee" }))).toBe(
      "🤝 A draw with Queen Vee at Chess on ClassiCade. Can you beat Queen Vee?",
    );
    expect(resultText(result({ outcome: "draw" }))).toBe("🤝 A draw at Chess on ClassiCade. Can you win it?");
  });

  it("invites in plain words when there is no result to tell, such as an aborted game", () => {
    expect(resultText(result({ outcome: "neutral", forfeit: true, score: "1-0" }))).toBe(
      "🎮 Come and play Chess with me on ClassiCade.",
    );
  });

  it("invites in plain words to a game this build does not know", () => {
    expect(resultText(result({ gameId: "ludo" }))).toBe("🎮 Come and play with me on ClassiCade.");
  });

  it("refuses an outcome it has no words for", () => {
    expect(() => resultText(result({ outcome: "watched" }))).toThrow(/outcome/);
  });

  it.each(GAMES.flatMap((game) => RESULT_OUTCOMES.map((outcome) => [game.id, outcome])))(
    "keeps the %s %s text short, on one line",
    (gameId, outcome) => {
      for (const character of ["", "Rocky"]) {
        const text = resultText(result({ gameId, outcome, character, score: "10-9" }));
        expect(text).not.toContain("\n");
        expect(text.length).toBeLessThanOrEqual(100);
      }
    },
  );
});

describe("inviteText", () => {
  it("invites to the room by its game and code", () => {
    expect(inviteText({ gameId: "chess", code: "AB2CD3" })).toBe(
      "Play Chess with me on ClassiCade — room AB2CD3",
    );
    expect(inviteText({ gameId: "ludo", code: "AB2CD3" })).toBe(
      "Play a game with me on ClassiCade — room AB2CD3",
    );
  });
});

describe("shareMessage and whatsappUrl", () => {
  it("puts the text, the free line and the link on their own lines", () => {
    expect(shareMessage({ text: "🏆 I won.", url: URL_ })).toBe(`🏆 I won.\nFree, no login needed.\n${URL_}`);
  });

  it("opens WhatsApp's chat picker with the whole message, encoded", () => {
    const message = shareMessage({ text: "🏆 I won 2-1 & more?", url: URL_ });

    const link = new URL(whatsappUrl(message));

    expect(`${link.origin}${link.pathname}`).toBe("https://wa.me/");
    expect([...link.searchParams.keys()]).toEqual(["text"]);
    expect(link.searchParams.get("text")).toBe(message);
    expect(whatsappUrl(message)).toContain("%26%20more%3F");
  });
});
