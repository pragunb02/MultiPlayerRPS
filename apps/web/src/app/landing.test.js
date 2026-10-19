import { describe, expect, it } from "vitest";
import { shareChannelOf, takeLanding } from "./landing.js";

const ORIGIN = "https://classicade.example";

/** A tab with an address and a history entry, which records every change to the address. */
function fakeWindow(path) {
  const tab = {
    replaced: 0,
    location: { href: `${ORIGIN}${path}` },
    history: {
      state: { idx: 2, key: "k1" },
      replaceState(state, _title, url) {
        tab.replaced += 1;
        tab.history.state = state;
        tab.location.href = new URL(url, ORIGIN).href;
      },
    },
  };
  return tab;
}
const path = (tab) => tab.location.href.slice(ORIGIN.length);
const land = (address) => {
  const window = fakeWindow(address);
  const document = globalThis.document.implementation.createHTMLDocument("landing");
  const landing = takeLanding({ window, document });
  return { window, root: document.documentElement, landing };
};

describe("shareChannelOf", () => {
  it.each([
    ["/games/chess?via=wa", "wa"],
    ["/games/chess?via=share", "share"],
    ["/games/chess/rooms/AB2CD3?via=copy", "copy"],
    ["/?next=%2Fprofile&via=wa#top", "wa"],
  ])("reads the channel of %s", (address, channel) => {
    expect(shareChannelOf(`${ORIGIN}${address}`)).toBe(channel);
  });

  it.each([
    ["no marker", "/games/chess"],
    ["an empty marker", "/games/chess?via="],
    ["a value not on the list", "/games/chess?via=telegram"],
    ["an id in the marker", "/games/chess?via=u_5f2a9c"],
    ["two markers", "/games/chess?via=wa&via=copy"],
    ["a marker in the hash only", "/games/chess#via=wa"],
  ])("finds no channel with %s", (_case, address) => {
    expect(shareChannelOf(`${ORIGIN}${address}`)).toBe("");
  });
});

describe("takeLanding (CC-279)", () => {
  it("counts a landing with a valid marker as a shared link of that channel", () => {
    const { landing } = land("/games/chess?via=wa");

    expect(landing).toEqual({ entry: "shared_link", via: "wa" });
    expect(Object.isFrozen(landing)).toBe(true);
  });

  it("writes the landing on the page's root element, for tests and telemetry", () => {
    const { root } = land("/games/tic-tac-toe?via=share");

    expect(root.dataset.ccEntry).toBe("shared_link");
    expect(root.dataset.ccVia).toBe("share");
  });

  it("removes the marker from the address, keeping the history entry, the other parameters and the hash", () => {
    const { window } = land("/login?next=%2Fgames%2Fchess&via=copy#form");

    expect(path(window)).toBe("/login?next=%2Fgames%2Fchess#form");
    expect(window.history.state).toEqual({ idx: 2, key: "k1" });
    expect(window.replaced).toBe(1);
  });

  it("removes the question mark too when the marker was the only parameter", () => {
    const { window } = land("/games/chess?via=wa");

    expect(path(window)).toBe("/games/chess");
  });

  it.each([
    ["a value not on the list", "/games/chess?via=telegram"],
    ["an id in the marker", "/games/chess?via=u_5f2a9c"],
    ["two markers", "/games/chess?via=wa&via=copy"],
  ])("ignores %s but still removes it, so it is never shared on", (_case, address) => {
    const { window, root, landing } = land(address);

    expect(landing).toEqual({ entry: "", via: "" });
    expect(root.hasAttribute("data-cc-entry")).toBe(false);
    expect(root.hasAttribute("data-cc-via")).toBe(false);
    expect(path(window)).toBe("/games/chess");
  });

  it("leaves an address without a marker exactly as it is", () => {
    const { window, root, landing } = land("/games/chess?b=2&a=1+x#top");

    expect(landing).toEqual({ entry: "", via: "" });
    expect(window.replaced).toBe(0);
    expect(path(window)).toBe("/games/chess?b=2&a=1+x#top");
    expect(root.hasAttribute("data-cc-entry")).toBe(false);
  });
});
