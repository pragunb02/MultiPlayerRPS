import { describe, expect, it } from "vitest";
import { isProfileHandle } from "@classicade/shared";
import { hasPlayerIdShape } from "./playerIdShape.js";
import { newProfileHandle } from "./profileHandle.js";

describe("newProfileHandle (CC-034)", () => {
  it("makes 16 letters of the handle alphabet, never shaped like a player id", () => {
    for (let i = 0; i < 200; i++) {
      const handle = newProfileHandle();
      expect(isProfileHandle(handle)).toBe(true);
      expect(hasPlayerIdShape(handle)).toBe(false);
    }
  });

  it("is a new random value each time", () => {
    const handles = new Set(Array.from({ length: 500 }, () => newProfileHandle()));

    expect(handles.size).toBe(500);
  });

  it("uses each byte's lowest five bits", () => {
    const bytes = (size) => Buffer.from(Array.from({ length: size }, (_, i) => i * 32 + i));

    expect(newProfileHandle(bytes)).toBe("0123456789abcdef");
  });
});
