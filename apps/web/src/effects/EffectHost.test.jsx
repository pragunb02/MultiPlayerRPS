import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesContext } from "../app/servicesContext.js";
import { InGameContext } from "../components/SiteRequests/inGameContext.js";
import { SessionContext } from "../hooks/useSession.js";
import { fakeApi, GUEST } from "../testing/fakes.js";
import { flagPaths } from "../testing/flagPaths.js";
import { installMatchMedia } from "../testing/matchMedia.js";
import { renderApp } from "../testing/render.jsx";
import { installVisibility } from "../testing/visibility.js";
import { play, previewTheme } from "./channel.js";
import { EffectHost } from "./EffectHost.jsx";
import { EventGreeting } from "./EventGreeting.jsx";
import { EFFECTS, effectNamed } from "./registry.js";

// The one effect host (CC-328, ADR-075): the queue, the gates and the theme, with scenes that only record what
// they were asked, so each test decides when an effect ends.

/** 8 November 2026, noon in India: Lakshmi Puja, inside the Diwali window. */
const PUJA = Date.parse("2026-11-08T12:00:00+05:30");
const AFTER_DIWALI = Date.parse("2026-11-12T00:30:00+05:30");
const TODAY = Date.parse("2026-10-21T12:00:00+05:30");

/** A scene that records each start and ends only when the test says. */
function recordedScene() {
  const runs = [];
  const start = vi.fn((canvas, options) => {
    let finish;
    const done = new Promise((resolve) => (finish = resolve));
    const run = { canvas, options, done, finish, stop: vi.fn(() => finish()) };
    runs.push(run);
    return run;
  });
  return { runs, start, load: vi.fn(async () => ({ start })) };
}

/** A registry entry with a recorded scene in place of the real one. */
function fake(name, fields = {}) {
  const scene = recordedScene();
  return { scene, entry: { ...effectNamed(name), load: scene.load, ...fields } };
}

function renderHost({ effects, now = () => TODAY, api = fakeApi(), inGame = false, path = "/" } = {}) {
  const tree = (playing) => (
    <MemoryRouter initialEntries={[path]}>
      <ServicesContext.Provider value={{ api }}>
        <SessionContext.Provider value={{ status: "ready", identity: GUEST }}>
          <InGameContext.Provider value={{ inGame: playing, setInGame: () => {} }}>
            <EventGreeting />
            <EffectHost effects={effects} now={now} />
          </InGameContext.Provider>
        </SessionContext.Provider>
      </ServicesContext.Provider>
    </MemoryRouter>
  );
  const view = render(tree(inGame));
  return { ...view, api, setInGame: (playing) => view.rerender(tree(playing)) };
}

const canvases = () => document.querySelectorAll("canvas");
const themeAttribute = () => document.documentElement.dataset.eventTheme;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
});

afterEach(() => {
  act(() => previewTheme(undefined));
  vi.useRealTimers();
});

describe("the effect host (CC-328)", () => {
  it("one standout effect at a time", async () => {
    let clock = TODAY;
    const win = fake("win_burst");
    const level = fake("level_up");
    const badge = fake("achievement");
    renderHost({ effects: [win.entry, level.entry, badge.entry], now: () => clock });

    let first;
    act(() => {
      first = play("win_burst", { origin: { x: 10, y: 20, width: 100 } });
    });
    await waitFor(() => expect(win.scene.runs).toHaveLength(1));
    expect(win.scene.runs[0].options).toEqual({
      origin: { x: 10, y: 20, width: 100 },
      particles: 120,
      durationMs: 1200,
    });
    expect(canvases()).toHaveLength(1);
    expect(win.scene.runs[0].canvas).toBe(canvases()[0]);

    // A second celebration waits behind the first, and starts when it ends.
    let second;
    act(() => {
      second = play("level_up");
    });
    await Promise.resolve();
    expect(level.scene.start).not.toHaveBeenCalled();
    await act(async () => win.scene.runs[0].finish());
    await expect(first).resolves.toBe(true);
    await waitFor(() => expect(level.scene.runs).toHaveLength(1));
    expect(canvases()).toHaveLength(1);

    // A third that would start more than 2 s late is dropped.
    let third;
    act(() => {
      third = play("achievement");
    });
    clock += 2001;
    await act(async () => level.scene.runs[0].finish());
    await expect(second).resolves.toBe(true);
    await expect(third).resolves.toBe(false);
    expect(badge.scene.start).not.toHaveBeenCalled();
    await waitFor(() => expect(canvases()).toHaveLength(0));
  });

  it("drops a play during a game, and stops one when a game starts", async () => {
    const win = fake("win_burst");
    const view = renderHost({ effects: [win.entry], inGame: true });

    await expect(play("win_burst")).resolves.toBe(false);
    view.setInGame(false);
    let played;
    act(() => {
      played = play("win_burst");
    });
    await waitFor(() => expect(win.scene.runs).toHaveLength(1));
    view.setInGame(true);
    await expect(played).resolves.toBe(false);
    expect(win.scene.runs[0].stop).toHaveBeenCalled();
    expect(canvases()).toHaveLength(0);
  });

  it("drops a play with no host, and an unknown name throws", async () => {
    await expect(play("win_burst")).resolves.toBe(false);
    expect(() => play("fireworks")).toThrow(RangeError);
  });

  it("is silent when an effect's chunk fails to load", async () => {
    const entry = { ...effectNamed("win_burst"), load: vi.fn().mockRejectedValue(new Error("chunk gone")) };
    renderHost({ effects: [entry] });

    let played;
    act(() => {
      played = play("win_burst");
    });
    await expect(played).resolves.toBe(false);
    await waitFor(() => expect(canvases()).toHaveLength(0));
  });

  it("reduced motion draws nothing", async () => {
    installMatchMedia({ reducedMotion: true });
    const win = fake("win_burst");
    const diwali = fake("diwali_2026");
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ event_diwali_2026: true }) });
    renderHost({ effects: [win.entry, diwali.entry], now: () => PUJA, api });

    // play resolves at once, loads nothing and makes no canvas.
    await expect(play("win_burst")).resolves.toBe(false);
    expect(win.scene.load).not.toHaveBeenCalled();
    // The theme keeps its colours (its chunk loads) and its greeting, without its burst.
    await waitFor(() => expect(themeAttribute()).toBe("diwali_2026"));
    expect(screen.getByText("Happy Diwali from all of us at ClassiCade.")).toBeVisible();
    await waitFor(() => expect(diwali.scene.load).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(diwali.scene.start).not.toHaveBeenCalled();
    expect(canvases()).toHaveLength(0);
  });

  it("stops and cleans up on unmount and hide", async () => {
    const visibility = installVisibility();
    const win = fake("win_burst");
    const removed = vi.spyOn(document, "removeEventListener");
    const view = renderHost({ effects: [win.entry] });

    let hidden;
    act(() => {
      hidden = play("win_burst");
    });
    await waitFor(() => expect(win.scene.runs).toHaveLength(1));
    act(() => visibility.setHidden(true));
    await expect(hidden).resolves.toBe(false);
    expect(win.scene.runs[0].stop).toHaveBeenCalled();
    expect(canvases()).toHaveLength(0);
    // Nothing starts while the tab is hidden.
    await expect(play("win_burst")).resolves.toBe(false);

    act(() => visibility.setHidden(false));
    let unmounted;
    act(() => {
      unmounted = play("win_burst");
    });
    await waitFor(() => expect(win.scene.runs).toHaveLength(2));
    view.unmount();
    await expect(unmounted).resolves.toBe(false);
    expect(win.scene.runs[1].stop).toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    // With the host gone a play is dropped, and the theme attribute is gone too.
    await expect(play("win_burst")).resolves.toBe(false);
    expect(themeAttribute()).toBeUndefined();
  });

  it("asks for no flag outside every theme's window", async () => {
    const api = fakeApi();
    renderHost({ api });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.getFlags).not.toHaveBeenCalled();
    expect(themeAttribute()).toBeUndefined();
  });

  it("plays a theme's entrance burst once per visit, on the home page only", async () => {
    const winter = fake("winter_2026");
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ event_winter_2026: true }) });
    const christmas = () => Date.parse("2026-12-25T10:00:00+05:30");

    const lobby = renderHost({ effects: [winter.entry], now: christmas, api, path: "/games/chess" });
    await waitFor(() => expect(winter.scene.load).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(winter.scene.start).not.toHaveBeenCalled();
    lobby.unmount();

    const home = renderHost({ effects: [winter.entry], now: christmas, api });
    await waitFor(() => expect(winter.scene.runs).toHaveLength(1));
    expect(winter.scene.runs[0].options).toMatchObject({ particles: 40, durationMs: 1500 });
    await act(async () => winter.scene.runs[0].finish());
    home.unmount();

    renderHost({ effects: [winter.entry], now: christmas, api });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(winter.scene.runs).toHaveLength(1);
  });

  it("never lets a theme's burst overlap a celebration", async () => {
    const win = fake("win_burst");
    const theme = { ...fake("diwali_2026").entry, name: "overlap_theme" };
    const burst = recordedScene();
    theme.load = burst.load;
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ event_diwali_2026: true }) });
    let resolveGate;
    // The celebration starts first and holds the canvas while the theme's chunk arrives.
    win.entry.load = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGate = () => resolve({ start: win.scene.start });
        }),
    );
    renderHost({ effects: [win.entry, theme], now: () => PUJA, api });
    act(() => {
      play("win_burst");
    });
    await waitFor(() => expect(burst.load).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(burst.start).not.toHaveBeenCalled();
    resolveGate();
    await waitFor(() => expect(win.scene.runs).toHaveLength(1));
  });
});

flagPaths("event_diwali_2026", (on) => {
  it("follows its flag and its window on the home hero, and counts a game started in the visit", async () => {
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ event_diwali_2026: on }) });
    const view = renderHost({ effects: EFFECTS, now: () => PUJA, api });

    await waitFor(() => expect(api.getFlags).toHaveBeenCalledWith(["event_diwali_2026"]));
    await waitFor(() => expect(themeAttribute()).toBe(on ? "diwali_2026" : undefined));
    const greeting = screen.queryByText("Diwali ki shubhkamnayein! Roshni aur khushiyan tumhare saath.");
    expect(greeting !== null).toBe(on);
    if (on) expect(greeting).toHaveAttribute("lang", "hi-Latn");

    view.setInGame(true);
    view.setInGame(false);
    view.setInGame(true);
    if (on) {
      await waitFor(() => expect(api.sendFlagSuccess).toHaveBeenCalledWith("event_diwali_2026"));
    }
    expect(api.sendFlagSuccess).toHaveBeenCalledTimes(on ? 1 : 0);
    view.unmount();
    expect(themeAttribute()).toBeUndefined();
  });

  it("is off again after its last day", async () => {
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ event_diwali_2026: on }) });
    renderHost({ effects: EFFECTS, now: () => AFTER_DIWALI, api });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.getFlags).not.toHaveBeenCalled();
    expect(themeAttribute()).toBeUndefined();
    expect(screen.queryByText(/Diwali/)).toBeNull();
  });

  it("shows the greeting above the home hero's headline in the real app", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PUJA);
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ event_diwali_2026: on }) });
    renderApp({ path: "/", api });

    const headline = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(themeAttribute()).toBe(on ? "diwali_2026" : undefined));
    const greeting = screen.queryByText("Happy Diwali from all of us at ClassiCade.");
    expect(greeting !== null).toBe(on);
    if (on) {
      expect(greeting.closest("p").nextElementSibling).toBe(headline);
    }
  });
});

flagPaths("event_winter_2026", (on) => {
  it("follows its flag inside its window, and is off on Diwali", async () => {
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ event_winter_2026: on }) });
    renderHost({ effects: EFFECTS, now: () => Date.parse("2027-01-01T09:00:00+05:30"), api });

    await waitFor(() => expect(api.getFlags).toHaveBeenCalledWith(["event_winter_2026"]));
    await waitFor(() => expect(themeAttribute()).toBe(on ? "winter_2026" : undefined));
    expect(screen.queryByText("Winter nights, warm games.") !== null).toBe(on);
  });
});

describe("the event theme at India midnight (CC-328)", () => {
  it("turns on when the window opens, without a reload", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = Date.parse("2026-11-05T23:59:30+05:30");
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ event_diwali_2026: true }) });
    renderHost({ effects: EFFECTS, now: () => clock, api });
    expect(api.getFlags).not.toHaveBeenCalled();

    clock += 31_000;
    await act(async () => vi.advanceTimersByTime(31_000));
    vi.useRealTimers();
    await waitFor(() => expect(themeAttribute()).toBe("diwali_2026"));
  });
});
