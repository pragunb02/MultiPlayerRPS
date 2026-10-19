import { describe, expect, it } from "vitest";
import { isShareChannel, SHARE_CHANNEL_PARAM, SHARE_CHANNELS, SHARED_LINK_ENTRY } from "./index.js";

describe("share channels (CC-279)", () => {
  it("are the three ways a link leaves our share buttons, and nothing else", () => {
    expect(SHARE_CHANNEL_PARAM).toBe("via");
    expect(Object.values(SHARE_CHANNELS)).toEqual(["wa", "share", "copy"]);
    expect(SHARED_LINK_ENTRY).toBe("shared_link");
  });

  it("cannot be changed at run time", () => {
    expect(Object.isFrozen(SHARE_CHANNELS)).toBe(true);
  });

  it.each(["wa", "share", "copy"])("knows %s", (value) => {
    expect(isShareChannel(value)).toBe(true);
  });

  it.each(["", "WA", "whatsapp", "wa ", "u_123", "copy,wa", "constructor", "toString"])(
    "refuses %j, so an id or a typo never counts as a channel",
    (value) => {
      expect(isShareChannel(value)).toBe(false);
    },
  );

  it.each([undefined, null, 1, ["wa"]])("refuses a value that is not a string (%j)", (value) => {
    expect(isShareChannel(value)).toBe(false);
  });
});
