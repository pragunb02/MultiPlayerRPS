import { describe, expect, it } from "vitest";
import { GAMES } from "@classicade/shared";
import {
  inviteText,
  RESULT_OUTCOMES,
  resultText,
  shareMessage,
  shareWasCancelled,
  whatsappUrl,
} from "./shareText.js";

const URL_ = "https://classicade.example/games/chess";
const FREE = "Free hai, login nahi chahiye.\nFree, no login needed.";
const result = (fields = {}) => ({
  gameId: "chess",
  outcome: "win",
  character: "",
  score: "",
  forfeit: false,
  ...fields,
});

describe("resultText: the Hinglish line first, the English line under it", () => {
  it("says the player beat the character, with the score, in the owner's words", () => {
    expect(resultText(result({ gameId: "rps", character: "Rocky", score: "2-1" }))).toBe(
      "🏆 Maine Rocky ko 2-1 se haraya! Tum try karo:\nI beat Rocky 2-1 at Rock Paper Scissors on ClassiCade. Can you beat Rocky?",
    );
    expect(resultText(result({ gameId: "rps", character: "Rocky" }))).toBe(
      "🏆 Maine Rocky ko haraya! Tum try karo:\nI beat Rocky at Rock Paper Scissors on ClassiCade. Can you beat Rocky?",
    );
  });

  it("says the player won against a person, without naming the person", () => {
    expect(resultText(result({ score: "3-2" }))).toBe(
      "🏆 Maine Chess jeeta 3-2 se! Ab tumhari baari:\nI won 3-2 at Chess on ClassiCade. Your turn!",
    );
    expect(resultText(result())).toBe(
      "🏆 Maine Chess jeeta! Ab tumhari baari:\nI won a game of Chess on ClassiCade. Your turn!",
    );
  });

  it("says a win by forfeit quietly", () => {
    expect(resultText(result({ forfeit: true }))).toBe(
      "🏆 Maine Chess jeeta! Ab tumhari baari:\nI won a game of Chess on ClassiCade (my opponent left). Your turn!",
    );
  });

  it("owns up to a loss kindly, and dares the friend", () => {
    expect(resultText(result({ gameId: "tictactoe", outcome: "loss", character: "Pip" }))).toBe(
      "🎯 Tic Tac Toe mein Pip ne mujhe hara diya. Badla loge?\nPip beat me at Tic Tac Toe on ClassiCade. Can you beat Pip?",
    );
    expect(resultText(result({ outcome: "loss" }))).toBe(
      "🎯 Aaj Chess mein haar mili. Badla loge?\nI played Chess on ClassiCade and lost. Can you do better?",
    );
  });

  it("calls a draw a draw", () => {
    expect(resultText(result({ outcome: "draw", character: "Queen Vee" }))).toBe(
      "🤝 Chess mein Queen Vee ke saath draw raha. Tum jeet ke dikhao:\nA draw with Queen Vee at Chess on ClassiCade. Can you beat Queen Vee?",
    );
    expect(resultText(result({ outcome: "draw" }))).toBe(
      "🤝 Chess mein draw raha. Tum jeet ke dikhao:\nA draw at Chess on ClassiCade. Can you win it?",
    );
  });

  it("invites in plain words when there is no result to tell, such as an aborted game", () => {
    expect(resultText(result({ outcome: "neutral", forfeit: true, score: "1-0" }))).toBe(
      "🎮 Ek game ho jaaye? ClassiCade pe Chess khelo:\nCome and play Chess with me on ClassiCade.",
    );
  });

  it("invites in plain words to a game this build does not know", () => {
    expect(resultText(result({ gameId: "ludo" }))).toBe(
      "🎮 Ek game ho jaaye? ClassiCade pe khelo:\nCome and play with me on ClassiCade.",
    );
  });

  it("refuses an outcome it has no words for", () => {
    expect(() => resultText(result({ outcome: "watched" }))).toThrow(/outcome/);
  });

  it.each(GAMES.flatMap((game) => RESULT_OUTCOMES.map((outcome) => [game.id, outcome])))(
    "keeps the %s %s text to two short lines",
    (gameId, outcome) => {
      for (const character of ["", "Rocky"]) {
        const text = resultText(result({ gameId, outcome, character, score: "10-9" }));
        const lines = text.split("\n");
        expect(lines).toHaveLength(2);
        for (const line of lines) expect(line.length).toBeLessThanOrEqual(100);
      }
    },
  );
});

describe("inviteText", () => {
  it("invites to the room in the owner's words, then by its game and code", () => {
    expect(inviteText({ gameId: "chess", code: "AB2CD3" })).toBe(
      "Ek game ho jaaye? ClassiCade pe Chess khelo, link kholo aur seedha khelo:\nPlay Chess with me on ClassiCade — room AB2CD3",
    );
    expect(inviteText({ gameId: "ludo", code: "AB2CD3" })).toBe(
      "Ek game ho jaaye? ClassiCade pe khelo, link kholo aur seedha khelo:\nPlay a game with me on ClassiCade — room AB2CD3",
    );
  });
});

describe("shareMessage and whatsappUrl", () => {
  it("puts the text, the free lines and the link on their own lines", () => {
    expect(shareMessage({ text: "🏆 I won.", url: URL_ })).toBe(`🏆 I won.\n${FREE}\n${URL_}`);
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

describe("shareWasCancelled", () => {
  it("is true only when the player closed the share sheet", () => {
    expect(shareWasCancelled(new DOMException("closed", "AbortError"))).toBe(true);
    expect(shareWasCancelled(new DOMException("not here", "NotAllowedError"))).toBe(false);
    expect(shareWasCancelled(new Error("broken"))).toBe(false);
    expect(shareWasCancelled(undefined)).toBe(false);
  });
});
