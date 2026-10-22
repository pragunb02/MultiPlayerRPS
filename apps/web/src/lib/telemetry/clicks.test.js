import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLICK_RULES, elementNameOf, watchClicks } from "./clicks.js";

let watcher;
let tracked;
let requests;

function setup(html) {
  document.body.innerHTML = html;
  tracked = [];
  requests = { http: 0, socket: 0 };
  watcher = watchClicks({
    document,
    view: window,
    track: (name, fields) => tracked.push([name, fields]),
    requestsSent: () => requests,
    MutationObserver: window.MutationObserver,
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer),
  });
}

const pointerUp = (element, x = 10, y = 10) =>
  element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: x, clientY: y }));
const named = (name) => tracked.filter(([event]) => event === name).map(([, fields]) => fields);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  watcher?.stop();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("presses (CC-174, EVENTS.md 3.2)", () => {
  it("counts a press on a control by its stable name and whether it showed a reason, never its text", () => {
    setup(`<main><button data-cc-control="home.play_guest"><span>Play as Riya</span></button>
      <button data-cc-control="room.rematch.ask" aria-disabled="true">Rematch</button></main>`);

    pointerUp(document.querySelector("span"));
    document
      .querySelector("[aria-disabled]")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(named("control_pressed")).toEqual([
      { control: "home.play_guest", has_reason: false },
      { control: "room.rematch.ask", has_reason: true },
    ]);
    expect(JSON.stringify(tracked)).not.toContain("Riya");
    expect(watcher.presses()).toBe(2);
  });

  // AC-5 (CC-174)
  it("three quick presses are one rage click", async () => {
    setup(`<main><div data-cc-control="ttt.cell" style="cursor:pointer">x</div></main>`);
    const cell = document.querySelector("div");

    pointerUp(cell, 10, 10);
    await vi.advanceTimersByTimeAsync(200);
    pointerUp(cell, 20, 15);
    await vi.advanceTimersByTimeAsync(200);
    pointerUp(cell, 15, 20);
    await vi.advanceTimersByTimeAsync(200);
    pointerUp(cell, 12, 12);
    await vi.advanceTimersByTimeAsync(CLICK_RULES.rageWithinMs + 1);

    expect(named("rage_clicked")).toEqual([{ control: "ttt.cell", presses: "4" }]);
  });

  it("presses far apart in time or place are not a rage click", async () => {
    setup(`<main><button data-cc-control="a.b">a</button></main>`);
    const button = document.querySelector("button");

    pointerUp(button, 0, 0);
    pointerUp(button, 100, 0);
    pointerUp(button, 200, 0);
    await vi.advanceTimersByTimeAsync(800);
    pointerUp(button, 0, 0);
    await vi.advanceTimersByTimeAsync(800);
    pointerUp(button, 0, 0);
    await vi.advanceTimersByTimeAsync(800);

    expect(named("rage_clicked")).toEqual([]);
  });

  // AC-6 (CC-174)
  it("a press that changes nothing is a dead click", async () => {
    setup(`<main>
      <section><button data-cc-control="lobby.nothing">Nothing</button><span data-cc-ticker>9</span></section>
      <section><button data-cc-control="lobby.answers">Answers</button><p id="out"></p></section>
      <section><button data-cc-control="lobby.sends">Sends</button></section>
      <img src="data:," alt="">
      <div id="card" style="cursor:pointer">Card</div>
      <p id="text">Plain words</p>
    </main>`);
    const [nothing, answers, sends] = document.querySelectorAll("button");

    pointerUp(nothing);
    // A ticker changing by itself is not an answer.
    document.querySelector("[data-cc-ticker]").textContent = "8";
    pointerUp(answers);
    document.getElementById("out").textContent = "Done";
    pointerUp(document.querySelector("img"));
    pointerUp(document.getElementById("card"));
    // Plain text does not look pressable, so a press on it is never counted (owner, 2026-10-20).
    pointerUp(document.getElementById("text"));
    await vi.advanceTimersByTimeAsync(CLICK_RULES.deadAfterMs - 1);
    expect(named("dead_clicked")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(named("dead_clicked")).toEqual([
      { control: "lobby.nothing" },
      { element: "img" },
      { element: "div" },
    ]);

    // A press that sent a request was answered, even before anything on screen changed.
    pointerUp(sends);
    requests = { http: 1, socket: 0 };
    await vi.advanceTimersByTimeAsync(CLICK_RULES.deadAfterMs);
    expect(named("dead_clicked")).toHaveLength(3);
  });

  it("a change just before the second is up still answers the press", () => {
    setup(`<main><button data-cc-control="lobby.late">Late</button><p id="out"></p></main>`);

    pointerUp(document.querySelector("button"));
    setTimeout(() => {
      document.getElementById("out").textContent = "Done";
    }, CLICK_RULES.deadAfterMs - 1);
    vi.advanceTimersByTime(CLICK_RULES.deadAfterMs);

    expect(named("dead_clicked")).toEqual([]);
  });

  it("a press that leads to a new address is answered, and a form field is never dead", async () => {
    setup(
      `<main><a data-cc-control="home.game" href="#games">Games</a><label>Name <input id="name"></label></main>`,
    );

    pointerUp(document.querySelector("a"));
    window.history.pushState({}, "", "/games/chess");
    pointerUp(document.getElementById("name"));
    document.getElementById("name").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await vi.advanceTimersByTimeAsync(CLICK_RULES.deadAfterMs);

    expect(named("dead_clicked")).toEqual([]);
    window.history.pushState({}, "", "/");
  });

  it("names an element by its tag and role only, from fixed lists", () => {
    const element = (html) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild;
    };

    expect(elementNameOf(element(`<div role="button">x</div>`))).toBe("div:button");
    expect(elementNameOf(element(`<img alt="Riya's avatar">`))).toBe("img");
    expect(elementNameOf(element(`<canvas role="AB2CD3"></canvas>`))).toBe("other:other");
  });

  it("names the interruption a press landed in, when the page says (CC-313's slot)", () => {
    document.body.innerHTML = `<main><button data-cc-control="toast.action">Undo</button></main>`;
    tracked = [];
    watcher = watchClicks({
      document,
      view: window,
      track: (name, fields) => tracked.push([name, fields]),
      requestsSent: () => ({ http: 0, socket: 0 }),
      MutationObserver: window.MutationObserver,
      now: () => Date.now(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer),
      surfaceOf: () => "toast.xp",
    });

    pointerUp(document.querySelector("button"));

    expect(named("control_pressed")).toEqual([
      { control: "toast.action", has_reason: false, surface: "toast.xp" },
    ]);
  });
});
