import { afterEach, describe, expect, it } from "vitest";
import { noteWaitingScreen, WAITED_CLASS, WAITED_LONG_CLASS } from "./wakingUp.js";

/**
 * A browser window whose styles say the screen is shown or still held back by its delay. Its "still waking up"
 * line has its own, longer delay.
 */
const windowWhere = (visibility, later = "hidden") => ({
  getComputedStyle: (element) => ({
    visibility: element.classList.contains("wake-later") ? later : visibility,
  }),
});

function addPageScreen() {
  const screen = document.createElement("div");
  screen.dataset.wake = "page";
  const later = document.createElement("p");
  later.className = "wake-later";
  screen.append(later);
  document.body.append(screen);
}

const marked = (name) => document.documentElement.classList.contains(name);

describe("noteWaitingScreen", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove(WAITED_CLASS, WAITED_LONG_CLASS);
  });

  it("marks the page when the player was already looking at the waking up screen", () => {
    addPageScreen();

    const seen = noteWaitingScreen({ document, window: windowWhere("visible") });

    expect(seen).toBe(true);
    expect(document.documentElement.classList.contains(WAITED_CLASS)).toBe(true);
  });

  it("keeps the still waking up line only when it was already showing as well", () => {
    addPageScreen();

    noteWaitingScreen({ document, window: windowWhere("visible") });

    expect(marked(WAITED_CLASS)).toBe(true);
    expect(marked(WAITED_LONG_CLASS)).toBe(false);
  });

  it("marks the page as having waited long when the still waking up line was showing too", () => {
    addPageScreen();

    const seen = noteWaitingScreen({ document, window: windowWhere("visible", "visible") });

    expect(seen).toBe(true);
    expect(marked(WAITED_CLASS)).toBe(true);
    expect(marked(WAITED_LONG_CLASS)).toBe(true);
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
