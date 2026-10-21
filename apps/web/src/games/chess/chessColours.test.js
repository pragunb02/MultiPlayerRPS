import { describe, expect, it } from "vitest";
import { colourName, opposite } from "./chessColours.js";
import * as chessGame from "./chessGame.js";

describe("chess colours, without chess.js (CC-322)", () => {
  it("names each colour and its opposite", () => {
    expect(colourName("w")).toBe("white");
    expect(colourName("b")).toBe("black");
    expect(opposite("w")).toBe("b");
    expect(opposite("b")).toBe("w");
  });

  it("are the same functions chessGame.js hands out, so the board and the puzzle card agree", () => {
    expect(chessGame.colourName).toBe(colourName);
    expect(chessGame.opposite).toBe(opposite);
  });
});
