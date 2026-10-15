import { describe, expect, it } from "vitest";
import { MOVE_REJECTIONS } from "@classicade/shared";
import { ok, reject } from "./result.js";

describe("result helpers", () => {
  it("wraps accepted values", () => {
    expect(ok({ add: 1 })).toEqual({ ok: true, value: { add: 1 } });
  });

  it("describes rejections with a known reason and a message", () => {
    expect(reject(MOVE_REJECTIONS.NOT_YOUR_TURN, "Wait")).toEqual({
      ok: false,
      reason: "NOT_YOUR_TURN",
      message: "Wait",
    });
  });

  it("refuses unknown rejection reasons (typos fail loudly)", () => {
    expect(() => reject("NOT_YOUR_TRUN", "Wait")).toThrow(TypeError);
  });

  it("returns frozen results", () => {
    expect(Object.isFrozen(ok(1))).toBe(true);
    expect(Object.isFrozen(reject(MOVE_REJECTIONS.GAME_OVER, "Over"))).toBe(true);
  });
});
