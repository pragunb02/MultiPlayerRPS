import { describe, expect, it } from "vitest";
import { RELOAD_GUARD_MS, RELOADED_PARAM, recoverFromStaleBuild } from "./staleBuild.js";

const ORIGIN = "https://classicade.example";

/** A browser tab with an address, a history entry and window events, which records every reload. */
function fakeWindow(path) {
  const listeners = new Map();
  const tab = {
    reloads: 0,
    location: {
      href: `${ORIGIN}${path}`,
      reload: () => {
        tab.reloads += 1;
      },
    },
    history: {
      state: { idx: 3, key: "abc" },
      replaceState(state, _title, url) {
        tab.history.state = state;
        tab.location.href = new URL(url, ORIGIN).href;
      },
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    listening: (type) => listeners.has(type),
    /** Vite reports a file that failed to load. Answers whether the failure was swallowed. */
    failLoad() {
      const event = new Event("vite:preloadError", { cancelable: true });
      listeners.get("vite:preloadError")?.(event);
      return event.defaultPrevented;
    },
  };
  return tab;
}

const clock = (start = 1_000) => {
  const time = { now: start };
  return { now: () => time.now, advance: (ms) => (time.now += ms) };
};
const path = (tab) => tab.location.href.slice(ORIGIN.length);

describe("recoverFromStaleBuild", () => {
  it("reloads once when a board of the old version fails to load, keeping the address and its history entry", () => {
    const tab = fakeWindow("/games/rock-paper-scissors/rooms/AB2CD3?x=1#top");
    recoverFromStaleBuild({ window: tab, now: clock().now });

    const swallowed = tab.failLoad();

    expect(swallowed).toBe(true);
    expect(tab.reloads).toBe(1);
    expect(path(tab)).toBe(`/games/rock-paper-scissors/rooms/AB2CD3?x=1&${RELOADED_PARAM}=1#top`);
    expect(tab.history.state).toEqual({ idx: 3, key: "abc" });
  });

  it("swallows further failures while the reload is under way, without reloading again", () => {
    const tab = fakeWindow("/games/chess/rooms/AB2CD3");
    recoverFromStaleBuild({ window: tab, now: clock().now });
    tab.failLoad();

    expect(tab.failLoad()).toBe(true);
    expect(tab.reloads).toBe(1);
  });

  it("removes the mark from the address of the page the reload opened, before anything reads it", () => {
    const tab = fakeWindow(`/games/chess/rooms/AB2CD3?${RELOADED_PARAM}=1#moves`);

    recoverFromStaleBuild({ window: tab, now: clock().now });

    expect(path(tab)).toBe("/games/chess/rooms/AB2CD3#moves");
    expect(tab.history.state).toEqual({ idx: 3, key: "abc" });
  });

  it("leaves an address without the mark alone", () => {
    const tab = fakeWindow("/games/chess?ref=home");
    const replaced = [];
    tab.history.replaceState = (...args) => replaced.push(args);

    recoverFromStaleBuild({ window: tab, now: clock().now });

    expect(replaced).toEqual([]);
  });

  it("shows the error instead of reloading again when the new page fails right away, so it never loops", () => {
    const tab = fakeWindow(`/games/chess/rooms/AB2CD3?${RELOADED_PARAM}=1`);
    const time = clock();
    recoverFromStaleBuild({ window: tab, now: time.now });
    time.advance(RELOAD_GUARD_MS - 1);

    const swallowed = tab.failLoad();

    expect(swallowed).toBe(false);
    expect(tab.reloads).toBe(0);
    expect(path(tab)).toBe("/games/chess/rooms/AB2CD3");
  });

  it("reloads again for a later deploy, long after the last reload", () => {
    const tab = fakeWindow(`/games/chess/rooms/AB2CD3?${RELOADED_PARAM}=1`);
    const time = clock();
    recoverFromStaleBuild({ window: tab, now: time.now });
    time.advance(RELOAD_GUARD_MS);

    expect(tab.failLoad()).toBe(true);
    expect(tab.reloads).toBe(1);
  });

  it("stops listening when asked", () => {
    const tab = fakeWindow("/");
    const stop = recoverFromStaleBuild({ window: tab, now: clock().now });

    stop();

    expect(tab.listening("vite:preloadError")).toBe(false);
    expect(tab.failLoad()).toBe(false);
    expect(tab.reloads).toBe(0);
  });
});
