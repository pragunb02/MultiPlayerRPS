import { describe, expect, it } from "vitest";
import { renameIdShapes } from "./idShapes.js";

const rename = (id) => `named:${id.length}`;

describe("renameIdShapes (CC-253, CC-297)", () => {
  it("renames every string shaped like a player id, as a value and as a key, at any depth", () => {
    const value = {
      who: "guest_00000000-0000-4000-8000-000000000001",
      list: ["user_65f1a2b3c4d5e6f708192a3b", "bot_rocky_easy", "deleted_x"],
      byPlayer: { "guest_00000000-0000-4000-8000-000000000001": { score: 1 } },
    };

    expect(renameIdShapes(value, rename)).toEqual({
      who: "named:42",
      list: ["named:29", "named:14", "named:9"],
      byPlayer: { "named:42": { score: 1 } },
    });
  });

  it("leaves everything else as it is", () => {
    const value = { name: "Alice", count: 3, on: true, none: null, at: [1, "rock"] };

    expect(renameIdShapes(value, rename)).toEqual(value);
    expect(renameIdShapes("Alice", rename)).toBe("Alice");
  });
});
