import { afterEach, describe, expect, it, vi } from "vitest";
import { INTENT_EVENTS, prefetchOnIntent } from "./routePrefetch.js";

const ORIGIN = window.location.origin;

afterEach(() => {
  document.body.replaceChildren();
});

/** A page with a link inside a card, an outside link and plain text, listening for intent. */
function page() {
  document.body.innerHTML = `
    <a href="/games/chess?level=easy#top"><span>Chess</span></a>
    <a href="https://example.com/games/chess">Elsewhere</a>
    <p>Just words</p>`;
  const preload = vi.fn();
  const stop = prefetchOnIntent({ document, origin: ORIGIN, preload });
  const [inside, outside] = document.querySelectorAll("a");
  return { preload, stop, inside: inside.querySelector("span"), outside, words: document.querySelector("p") };
}

describe("prefetchOnIntent: a page's code, fetched when a player is about to open it (CC-322)", () => {
  it.each(INTENT_EVENTS)("passes on the path of this site's link on %s, from anywhere inside it", (type) => {
    const { preload, inside } = page();

    inside.dispatchEvent(new Event(type, { bubbles: true }));

    expect(preload).toHaveBeenCalledExactlyOnceWith("/games/chess");
  });

  it("ignores links to other sites, and anything that is not a link", () => {
    const { preload, outside, words } = page();

    outside.dispatchEvent(new Event("pointerover", { bubbles: true }));
    words.dispatchEvent(new Event("pointerover", { bubbles: true }));
    document.dispatchEvent(new Event("focusin"));

    expect(preload).not.toHaveBeenCalled();
  });

  it("stops listening when asked", () => {
    const { preload, stop, inside } = page();

    stop();
    for (const type of INTENT_EVENTS) {
      inside.dispatchEvent(new Event(type, { bubbles: true }));
    }

    expect(preload).not.toHaveBeenCalled();
  });
});
