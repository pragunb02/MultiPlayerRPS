import { afterEach, describe, expect, it } from "vitest";
import { followInputModality, KEYBOARD_CLASS } from "./inputModality.js";

const usingKeyboard = () => document.documentElement.classList.contains(KEYBOARD_CLASS);
const press = (type, target = document.body) =>
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

describe("followInputModality", () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    document.body.replaceChildren();
  });

  it("is not on the keyboard before any press, so focus moved on page load draws no ring", () => {
    stop = followInputModality(document);

    expect(usingKeyboard()).toBe(false);
  });

  it("marks the page on a key press and unmarks it on a click or a touch", () => {
    stop = followInputModality(document);

    press("keydown");
    expect(usingKeyboard()).toBe(true);
    press("pointerdown");
    expect(usingKeyboard()).toBe(false);
  });

  it("notes the key before a handler that stops it, so focus that key moves in code shows the ring", () => {
    const button = document.createElement("button");
    let seen = null;
    button.addEventListener("keydown", (event) => {
      event.stopPropagation();
      seen = usingKeyboard();
    });
    document.body.append(button);
    stop = followInputModality(document);

    press("keydown", button);

    expect(seen).toBe(true);
  });

  it("stops following and unmarks the page when stopped", () => {
    stop = followInputModality(document);
    press("keydown");

    stop();
    press("keydown");

    expect(usingKeyboard()).toBe(false);
  });
});
