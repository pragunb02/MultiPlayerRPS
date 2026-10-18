import { describe, expect, it, vi } from "vitest";
import { actionBarItems, MAX_ACTIONS, sendIntent, shellLayout } from "./matchShell.js";

const room = (overrides = {}) => ({ status: "playing", you: "guest_me", ...overrides });
const action = (control) => ({
  control,
  label: control,
  reason: "",
  intent: { type: "move", move: { type: control } },
});
const withActions = (...controls) => ({ actions: () => controls.map(action) });
const kinds = (items) => items.map((item) => (item.kind === "game" ? item.action.control : item.kind));

describe("shellLayout", () => {
  it("shows the invite on the stage while the room waits for players", () => {
    expect(shellLayout(room({ status: "waiting" }))).toEqual({
      stage: "waiting",
      result: false,
      actionBar: "under-stage",
    });
  });

  it("shows the board with the action bar under it while the game is on", () => {
    expect(shellLayout(room())).toEqual({ stage: "board", result: false, actionBar: "under-stage" });
  });

  it("shows the result at the end, with the action bar inside it", () => {
    expect(shellLayout(room({ status: "finished" }))).toEqual({
      stage: "board",
      result: true,
      actionBar: "in-result",
    });
  });
});

describe("actionBarItems", () => {
  it("has only Leave while the room waits, whatever the game brings", () => {
    expect(kinds(actionBarItems(room({ status: "waiting" }), withActions("a.one")))).toEqual(["leave"]);
  });

  it("puts the game's actions before Leave for a seated player while the game is on", () => {
    expect(kinds(actionBarItems(room(), withActions("a.one", "a.two")))).toEqual(["a.one", "a.two", "leave"]);
  });

  it("has only Leave for a game without actions", () => {
    expect(kinds(actionBarItems(room(), {}))).toEqual(["leave"]);
  });

  it("gives a spectator no game actions", () => {
    expect(kinds(actionBarItems(room({ you: "" }), withActions("a.one")))).toEqual(["leave"]);
  });

  it("asks the game for its actions with the room", () => {
    const actions = vi.fn(() => []);
    const view = room();

    actionBarItems(view, { actions });

    expect(actions).toHaveBeenCalledWith(view);
  });

  it("offers Rematch first, then New opponent and Leave, at the end", () => {
    expect(kinds(actionBarItems(room({ status: "finished" }), withActions("a.one")))).toEqual([
      "rematch",
      "new-opponent",
      "leave",
    ]);
  });

  it("offers a spectator the game's lobby and Leave at the end", () => {
    expect(kinds(actionBarItems(room({ status: "finished", you: "" }), {}))).toEqual(["play-game", "leave"]);
  });

  it("fails at once for a game with more actions than fit beside Leave", () => {
    const many = Array.from({ length: MAX_ACTIONS }, (_, index) => `a.${index}`);

    expect(() => actionBarItems(room(), withActions(...many))).toThrow(/at most 3 actions/);
    expect(kinds(actionBarItems(room(), withActions(...many.slice(1))))).toHaveLength(MAX_ACTIONS);
  });

  it("returns a list nobody can change", () => {
    expect(Object.isFrozen(actionBarItems(room(), {}))).toBe(true);
    expect(Object.isFrozen(actionBarItems(room({ status: "finished" }), {}))).toBe(true);
  });
});

describe("sendIntent", () => {
  const send = () => ({ onMove: vi.fn(async () => "moved"), onAsk: vi.fn(async () => "asked") });

  it("sends a move through onMove", async () => {
    const calls = send();

    await expect(sendIntent({ type: "move", move: { type: "resign" } }, calls)).resolves.toBe("moved");
    expect(calls.onMove).toHaveBeenCalledWith({ type: "resign" });
    expect(calls.onAsk).not.toHaveBeenCalled();
  });

  it("sends a request through onAsk", async () => {
    const calls = send();

    await expect(sendIntent({ type: "ask", requestType: "draw" }, calls)).resolves.toBe("asked");
    expect(calls.onAsk).toHaveBeenCalledWith("draw");
  });

  it("fails at once for anything else", () => {
    expect(() => sendIntent({ type: "answer" }, send())).toThrow(/cannot send "answer"/);
  });
});
