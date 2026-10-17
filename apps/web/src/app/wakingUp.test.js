import { afterEach, describe, expect, it } from "vitest";
import { noteWaitingScreen, WAITED_CLASS } from "./wakingUp.js";

/** A browser window whose styles say the screen is shown or still held back by its delay. */
const windowWhere = (visibility) => ({ getComputedStyle: () => ({ visibility }) });

function addPageScreen() {
  const screen = document.createElement("div");
  screen.dataset.wake = "page";
  document.body.append(screen);
}

describe("noteWaitingScreen", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove(WAITED_CLASS);
  });

  it("marks the page when the player was already looking at the waking up screen", () => {
    addPageScreen();

    const seen = noteWaitingScreen({ document, window: windowWhere("visible") });

    expect(seen).toBe(true);
    expect(document.documentElement.classList.contains(WAITED_CLASS)).toBe(true);
  });

  it("leaves the page alone when the app started before the screen's delay was over", () => {
    addPageScreen();

    const seen = noteWaitingScreen({ document, window: windowWhere("hidden") });

    expect(seen).toBe(false);
    expect(document.documentElement.classList.contains(WAITED_CLASS)).toBe(false);
  });

  it("leaves the page alone when the HTML has no waking up screen", () => {
    const seen = noteWaitingScreen({ document, window: windowWhere("visible") });

    expect(seen).toBe(false);
    expect(document.documentElement.classList.contains(WAITED_CLASS)).toBe(false);
  });
});
