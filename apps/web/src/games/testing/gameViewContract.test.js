import { describe, expect, it } from "vitest";
import { checkGameViewContract } from "./gameViewContract.js";

const ROOMS = Object.freeze({ playing: { you: "guest_me", requests: [] } });
const action = (overrides = {}) => ({
  control: "fake.go",
  label: "Go",
  reason: "",
  intent: { type: "move", move: {} },
  ...overrides,
});
const check = (fields) => checkGameViewContract({ entry: Object.freeze(fields), rooms: ROOMS });

describe("checkGameViewContract", () => {
  it("passes an entry with only a board", () => {
    expect(check({ Board: () => null })).toEqual([]);
  });

  it("passes actions and a score of the right shape", () => {
    expect(
      check({
        actions: () => [action(), action({ control: "fake.ask", intent: { type: "ask", requestType: "x" } })],
        inGameScore: () => ({ text: "1 to 0" }),
      }),
    ).toEqual([]);
    expect(check({ inGameScore: () => undefined })).toEqual([]);
  });

  it("finds an entry that is not frozen, and fields of the wrong kind", () => {
    expect(checkGameViewContract({ entry: { Board: () => null }, rooms: ROOMS })).toEqual([
      "the entry must be frozen",
    ]);
    expect(check({ Board: "board", actions: [], requestTexts: {} })).toEqual([
      "Board must be a component",
      "actions must be a function",
      "requestTexts must be frozen",
    ]);
  });

  it("finds actions that the shell cannot draw", () => {
    const problems = check({
      actions: () => [
        action({ control: "Go", label: "", reason: undefined, variant: "huge" }),
        action({ intent: { type: "move" }, confirm: { title: "Sure?" } }),
        action({ intent: { type: "ask" } }),
        action({ intent: { type: "answer" } }),
      ],
    });

    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/at most 3 fit beside Leave/),
        expect.stringMatching(/controls repeat/),
        expect.stringMatching(/control "Go" is not a dotted name/),
        expect.stringMatching(/has no label/),
        expect.stringMatching(/reason must be a string/),
        expect.stringMatching(/variant "huge"/),
        expect.stringMatching(/a move intent needs a move object/),
        expect.stringMatching(/confirm needs/),
        expect.stringMatching(/an ask intent needs a request type/),
        expect.stringMatching(/intent type must be/),
      ]),
    );
  });

  it("finds a function that gives a different answer for the same room", () => {
    let calls = 0;
    let scores = 0;

    expect(check({ actions: () => [action({ label: `Go ${calls++}` })] })).toEqual([
      "actions for playing: the same room gave a different answer",
    ]);
    expect(check({ inGameScore: () => ({ text: `${scores++}` }) })).toEqual([
      "inGameScore for playing: the same room gave a different answer",
    ]);
  });

  it("finds a function that changes the room", () => {
    const inGameScore = (room) => {
      room.you = "someone else";
      return { text: "1" };
    };

    expect(check({ inGameScore })).toEqual([expect.stringMatching(/^playing: /)]);
  });

  it("finds a list that is not a list, and a score without words", () => {
    expect(check({ actions: () => "none" })).toEqual(["actions for playing must return a list"]);
    expect(check({ inGameScore: () => ({ text: "" }) })).toEqual([
      "inGameScore for playing must be undefined or { text }",
    ]);
  });
});
