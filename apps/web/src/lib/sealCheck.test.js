import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkSeal, shortLock } from "./sealCheck.js";

const sha256 = async (text) =>
  Array.from(new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

describe("checkSeal", () => {
  it("matches when the SHA-256 of the text, a colon and the salt is the lock", async () => {
    const commitment = await sha256('{"choice":"rock"}:abc123');

    expect(await checkSeal({ text: '{"choice":"rock"}', salt: "abc123", commitment }, webcrypto.subtle)).toBe(
      true,
    );
  });

  it("does not match when the throw is not the one that was locked", async () => {
    const commitment = await sha256('{"choice":"rock"}:abc123');

    expect(
      await checkSeal({ text: '{"choice":"paper"}', salt: "abc123", commitment }, webcrypto.subtle),
    ).toBe(false);
  });

  it("uses the browser's own hashing by default", async () => {
    const commitment = await sha256("t:s");

    expect(await checkSeal({ text: "t", salt: "s", commitment })).toBe(true);
  });

  it("says so when the browser cannot hash (a page without HTTPS)", async () => {
    vi.stubGlobal("crypto", {});
    try {
      await expect(checkSeal({ text: "t", salt: "s", commitment: "x" })).rejects.toThrow(
        "This browser cannot check the lock",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("shortLock", () => {
  it("keeps the start and the end of a lock", () => {
    expect(shortLock("7f3a0000000000000000c21")).toBe("7f3a…c21");
  });
});
