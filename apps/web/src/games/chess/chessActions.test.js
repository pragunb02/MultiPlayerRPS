import { describe, expect, it } from "vitest";
import { chessActions } from "./chessActions.js";

const offer = (from, to) => ({
  type: "draw",
  from,
  to,
  createdAt: 1,
  expiresAt: 2,
  state: "open",
  endedAt: 0,
});
const room = (requests = []) => ({ you: "guest_me", requests });
const byControl = (actions) => Object.fromEntries(actions.map((action) => [action.control, action]));

describe("chessActions", () => {
  it("offers a draw as a room request and resigns as a move, asking first", () => {
    const actions = byControl(chessActions(room()));

    expect(Object.keys(actions)).toEqual(["chess.offer_draw", "chess.resign"]);
    expect(actions["chess.offer_draw"]).toMatchObject({
      label: "Offer draw",
      intent: { type: "ask", requestType: "draw" },
    });
    expect(actions["chess.resign"]).toMatchObject({
      label: "Resign",
      intent: { type: "move", move: { type: "resign" } },
      confirm: { title: "Resign this game?", confirmLabel: "Resign", keepLabel: "Keep playing" },
    });
  });

  it("shows the viewer's own standing offer as sent", () => {
    const actions = byControl(chessActions(room([offer("guest_me", "guest_them")])));

    expect(actions["chess.offer_draw"].label).toBe("Draw offered");
  });

  it("keeps the offer button as it is for the opponent's offer, which the banner answers", () => {
    const actions = byControl(chessActions(room([offer("guest_them", "guest_me")])));

    expect(actions["chess.offer_draw"].label).toBe("Offer draw");
  });

  it("leaves the reasons to the shell: neither action waits for your turn", () => {
    expect(chessActions(room()).map((action) => action.reason)).toEqual(["", ""]);
  });
});
