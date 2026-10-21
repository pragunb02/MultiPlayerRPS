import { render, waitFor } from "@testing-library/react";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exampleTelemetryEvent } from "@classicade/shared/testing";
import { ServicesContext } from "../../app/servicesContext.js";
import { SessionContext } from "../../hooks/useSession.js";
import { fakeApi } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { TelemetryHost } from "./TelemetryHost.jsx";
import { TELEMETRY_BATCH, createTelemetryClient, deviceOf } from "./client.js";
import { createTelemetryFacade } from "./facade.js";
import { isTelemetryOff, TELEMETRY_STORAGE_KEY } from "./optOut.js";

const BUILD = "0.1.0+abc1234";
const HOME = { route: "/", playerKind: "visitor" };

/** A client on fake timers that records what it sent: `posts` by fetch, `beacons` by sendBeacon. */
function setup({ off = false, sendOk = true, width = 390 } = {}) {
  const posts = [];
  const beacons = [];
  const answers = [];
  const state = { off, sendOk };
  const client = createTelemetryClient({
    build: BUILD,
    send: vi.fn(async (body) => {
      posts.push(JSON.parse(body));
      const ok = answers.length > 0 ? answers.shift() : state.sendOk;
      if (ok === "throw") throw new TypeError("Failed to fetch");
      return ok;
    }),
    beacon: vi.fn((body) => {
      beacons.push(JSON.parse(body));
      return true;
    }),
    isOff: () => state.off,
    viewportWidth: () => width,
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer),
    strict: true,
    onAccepted: vi.fn(),
  });
  return { client, posts, beacons, answers, state };
}

const press = (control = "home.play_guest") => ["control_pressed", { control, has_reason: false }];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the telemetry client (CC-174)", () => {
  // AC-1 (CC-174)
  it("an unknown event name throws", () => {
    const { client, posts, beacons } = setup();

    expect(() => client.track("page_view", {}, HOME)).toThrow(RangeError);
    expect(() => client.track("account_created", { from_guest: true }, HOME)).toThrow(RangeError);
    expect(() =>
      client.track("control_pressed", { control: "Room.AB2CD3", has_reason: false }, HOME),
    ).toThrow(RangeError);
    client.flushNow();
    vi.runAllTimers();

    expect(posts).toEqual([]);
    expect(beacons).toEqual([]);
  });

  // AC-2 (CC-174)
  it("sends nothing when opted out, with GPC or with DNT", () => {
    const storage = new Map();
    const getStorage = () => ({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    });
    const site = { hostname: "nocapgaming.onrender.com" };
    const browsers = {
      switch: [{ doNotTrack: null }, () => storage.set(TELEMETRY_STORAGE_KEY, "off")],
      gpc: [{ globalPrivacyControl: true, doNotTrack: null }, () => storage.clear()],
      dnt: [{ doNotTrack: "1" }, () => storage.clear()],
    };

    Object.values(browsers).forEach(([navigator, prepare]) => {
      prepare();
      const isOff = () => isTelemetryOff({ getStorage, navigator, location: site });
      const facade = createTelemetryFacade({ isOff });
      const { client, posts, beacons } = setup();
      const offClient = createTelemetryClient({
        build: BUILD,
        send: async (body) => posts.push(body) > 0,
        beacon: (body) => beacons.push(body) > 0,
        isOff,
        viewportWidth: () => 390,
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: (timer) => clearTimeout(timer),
        strict: true,
      });
      facade.track(...press());
      facade.attach(offClient);
      facade.track("page_viewed", { is_landing: true, entry: "direct" });
      facade.track(...press());
      offClient.track(...press(), HOME);
      vi.advanceTimersByTime(TELEMETRY_BATCH.everyMs * 2);
      offClient.flushNow();
      client.stop();

      expect(posts).toEqual([]);
      expect(beacons).toEqual([]);
    });
    // Only the switch itself is in storage, and only when the player turned it off: nothing says GPC or DNT did.
    expect([...storage.keys()]).toEqual([]);
    expect(isTelemetryOff({ getStorage, navigator: { doNotTrack: null }, location: site })).toBe(false);
    expect(isTelemetryOff({ getStorage, navigator: { webdriver: true }, location: site })).toBe(true);
    expect(isTelemetryOff({ getStorage, navigator: {}, location: { hostname: "localhost" } })).toBe(true);
  });

  // AC-3 (CC-174)
  it("batches by count, by time and on pagehide", async () => {
    const { client, posts, beacons, answers } = setup();

    // 20 events go at once, as one batch.
    for (let index = 0; index < TELEMETRY_BATCH.maxEvents; index += 1) client.track(...press(), HOME);
    await vi.advanceTimersByTimeAsync(0);
    expect(posts).toHaveLength(1);
    expect(posts[0].build).toBe(BUILD);
    expect(posts[0].events).toHaveLength(20);

    // Fewer go after 10 seconds.
    client.track(...press(), HOME);
    await vi.advanceTimersByTimeAsync(TELEMETRY_BATCH.everyMs - 1);
    expect(posts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(posts).toHaveLength(2);
    expect(posts[1].events).toHaveLength(1);

    // On pagehide the rest go by sendBeacon, at once.
    client.track(...press(), HOME);
    client.flushNow();
    expect(beacons).toEqual([
      {
        build: BUILD,
        events: [
          {
            name: "control_pressed",
            route: "/",
            device: "phone",
            player_kind: "visitor",
            control: "home.play_guest",
            has_reason: false,
          },
        ],
      },
    ]);

    // A failed batch is tried once more, then dropped.
    answers.push(false, "throw");
    client.track(...press(), HOME);
    await vi.advanceTimersByTimeAsync(TELEMETRY_BATCH.everyMs);
    expect(posts).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(TELEMETRY_BATCH.retryAfterMs);
    expect(posts).toHaveLength(4);
    expect(posts[3]).toEqual(posts[2]);
    await vi.advanceTimersByTimeAsync(TELEMETRY_BATCH.retryAfterMs * 10);
    expect(posts).toHaveLength(4);
  });

  it("a batch whose send failed on the network is tried once more", async () => {
    const { client, posts, answers } = setup();
    answers.push("throw", true);

    client.track(...press(), HOME);
    client.flush();
    await vi.advanceTimersByTimeAsync(TELEMETRY_BATCH.retryAfterMs);

    expect(posts).toHaveLength(2);
  });

  it("tells once that the server took a batch, for the flag's success", async () => {
    const { client } = setup();
    const onAccepted = vi.fn();
    const counted = createTelemetryClient({
      build: BUILD,
      send: async () => true,
      beacon: () => true,
      isOff: () => false,
      viewportWidth: () => 1280,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer),
      strict: true,
      onAccepted,
    });

    counted.track(...press(), HOME);
    counted.flush();
    counted.track(...press(), HOME);
    counted.flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(onAccepted).toHaveBeenCalledOnce();
    client.stop();
  });

  it("in production drops an event the catalogue refuses instead of throwing, and an unknown name still throws", () => {
    const posts = [];
    const lenient = createTelemetryClient({
      build: BUILD,
      send: async (body) => posts.push(body) > 0,
      beacon: () => true,
      isOff: () => false,
      viewportWidth: () => 390,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer),
      strict: false,
    });

    lenient.track("control_pressed", { control: "Room.AB2CD3", has_reason: false }, HOME);
    lenient.flush();
    expect(posts).toEqual([]);
    expect(() => lenient.track("nope", {}, HOME)).toThrow(RangeError);
  });

  it("gives each event the width class of the viewport, never the width", () => {
    expect([320, 599, 600, 1023, 1024, 2560].map(deviceOf)).toEqual([
      "phone",
      "phone",
      "tablet",
      "tablet",
      "desktop",
      "desktop",
    ]);
  });
});

describe("the client's defaults (CC-174)", () => {
  it("needs no onAccepted, and a stopped client queues nothing", async () => {
    const posts = [];
    const quiet = createTelemetryClient({
      build: BUILD,
      send: async (body) => posts.push(body) > 0,
      beacon: () => true,
      isOff: () => false,
      viewportWidth: () => 390,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer),
      strict: true,
    });

    quiet.track(...press(), HOME);
    quiet.flush();
    await vi.advanceTimersByTimeAsync(0);
    quiet.stop();
    quiet.track(...press(), HOME);
    quiet.flush();

    expect(posts).toHaveLength(1);
  });
});

describe("the facade (CC-174)", () => {
  it("holds events until the client is attached, with the screen each was on, then hands them over", () => {
    const facade = createTelemetryFacade({ isOff: () => false });
    const { client, beacons } = setup();

    facade.setContext({ route: "/games/chess", playerKind: "guest" });
    facade.track(...press("lobby.create"));
    facade.setContext({ route: "/games/chess/rooms/:code", playerKind: "guest" });
    facade.attach(client);
    facade.track(...press("room.leave"));
    client.flushNow();

    expect(beacons[0].events.map(({ route, control }) => [route, control])).toEqual([
      ["/games/chess", "lobby.create"],
      ["/games/chess/rooms/:code", "room.leave"],
    ]);
  });

  it("drops what it holds when counts turn out to be off, and holds at most 100", () => {
    const facade = createTelemetryFacade({ isOff: () => false });
    const { client, beacons } = setup();
    for (let index = 0; index < 150; index += 1) facade.track(...press());

    facade.detach();
    facade.attach(client);
    client.flushNow();
    expect(beacons).toEqual([]);

    const again = createTelemetryFacade({ isOff: () => false });
    for (let index = 0; index < 150; index += 1) again.track(...press());
    const other = setup();
    again.attach(other.client);
    other.client.flushNow();
    const handed = [...other.posts, ...other.beacons].flatMap(({ events }) => events);
    expect(handed).toHaveLength(100);
  });

  it("keeps the screen, the kind of player and how the page load arrived", () => {
    const facade = createTelemetryFacade({ isOff: () => false, landing: { entry: "search", via: "" } });

    expect(facade.context()).toEqual({ route: "not_found", playerKind: "visitor" });
    facade.setContext({ route: "/", playerKind: "guest" });
    expect(facade.landing).toEqual({ entry: "search", via: "" });
    facade.setLanding({ entry: "shared_link", via: "copy" });

    expect(facade.context()).toEqual({ route: "/", playerKind: "guest" });
    expect(facade.landing).toEqual({ entry: "shared_link", via: "copy" });
    expect(createTelemetryFacade({ isOff: () => false }).landing).toEqual({ entry: "direct", via: "" });
  });

  it("counts the requests it is told of, for the click watcher", () => {
    const facade = createTelemetryFacade({ isOff: () => false });

    facade.noteRequest("http");
    facade.noteRequest("socket");
    facade.noteRequest("socket");
    facade.noteRequest("carrier pigeon");

    expect(facade.requestsSent()).toEqual({ http: 1, socket: 2 });
  });

  it("stops at once when the switch is turned off, and tells its listeners", () => {
    let off = false;
    const facade = createTelemetryFacade({ isOff: () => off });
    const { client, beacons } = setup();
    const heard = vi.fn();
    facade.onSwitched(heard);
    facade.attach(client);
    facade.track(...press());

    off = true;
    facade.switched();
    facade.track(...press());
    client.flushNow();

    expect(heard).toHaveBeenCalledOnce();
    expect(beacons).toEqual([]);
    expect(exampleTelemetryEvent("page_viewed").name).toBe("page_viewed");
  });
});

describe("the host (CC-174)", () => {
  it("loads when the browser is idle, and counts the flag's success once the server took a batch", async () => {
    vi.useRealTimers();
    const idle = vi.fn((run) => setTimeout(run, 0));
    vi.stubGlobal("requestIdleCallback", idle);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 204 })),
    );
    const api = fakeApi({
      getFlags: vi.fn(async () => ({ telemetry_client: true })),
      sendFlagSuccess: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const telemetry = createTelemetryFacade({ isOff: () => false });
    render(
      h(
        MemoryRouter,
        { initialEntries: ["/"] },
        h(
          ServicesContext.Provider,
          { value: { api, telemetry } },
          h(
            SessionContext.Provider,
            { value: { status: "anonymous", identity: undefined } },
            h(TelemetryHost),
          ),
        ),
      ),
    );

    await waitFor(() => expect(telemetry.isAttached()).toBe(true));
    for (let index = 0; index < TELEMETRY_BATCH.maxEvents; index += 1) {
      telemetry.track("control_pressed", { control: "home.play_guest", has_reason: false });
    }

    await waitFor(() => expect(api.sendFlagSuccess).toHaveBeenCalledWith("telemetry_client"));
    expect(idle).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe("the host when the flag turns off while the client loads (owner review 2026-10-21)", () => {
  it("never starts a client whose flag went off before its file arrived", async () => {
    vi.useRealTimers();
    let arrive;
    const load = vi.fn(() => new Promise((resolve) => (arrive = resolve)));
    const api = fakeApi({
      getFlags: vi.fn(async () => ({ telemetry_client: true })),
    });
    const telemetry = createTelemetryFacade({ isOff: () => false });
    const tree = (identity, flags) =>
      h(
        MemoryRouter,
        { initialEntries: ["/"] },
        h(
          ServicesContext.Provider,
          { value: { api: { ...api, getFlags: flags }, telemetry } },
          h(
            SessionContext.Provider,
            { value: { status: identity ? "ready" : "anonymous", identity } },
            h(TelemetryHost, { load }),
          ),
        ),
      );
    const view = render(tree(undefined, api.getFlags));
    await waitFor(() => expect(load).toHaveBeenCalledOnce());

    // A new session, for whom the flag is off, while the file is still on its way.
    const off = vi.fn(async () => ({ telemetry_client: false }));
    view.rerender(tree({ kind: "guest", id: "guest_x", displayName: "Guest-T001" }, off));
    await waitFor(() => expect(off).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    arrive(await import("./index.js"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(telemetry.isAttached()).toBe(false);
    view.unmount();
  });
});

describe("the telemetry_client flag (CC-174)", () => {
  // AC-8 (CC-174)
  flagPaths("telemetry_client", (on) => {
    it(on ? "loads the client and sends the page view" : "loads nothing and sends nothing", async () => {
      vi.useRealTimers();
      const beacons = [];
      vi.stubGlobal("navigator", {
        ...navigator,
        sendBeacon: (url, body) => beacons.push([url, JSON.parse(body)]) > 0,
      });
      const fetched = vi.fn(async () => ({ status: 204 }));
      vi.stubGlobal("fetch", fetched);
      const api = fakeApi({ getFlags: vi.fn(async () => ({ telemetry_client: on })) });
      const telemetry = createTelemetryFacade({ isOff: () => false });
      const load = vi.fn(() => import("./index.js"));
      render(
        h(
          MemoryRouter,
          { initialEntries: ["/games/chess/rooms/AB2CD3"] },
          h(
            ServicesContext.Provider,
            { value: { api, telemetry } },
            h(
              SessionContext.Provider,
              { value: { status: "anonymous", identity: undefined } },
              h(TelemetryHost, { load }),
            ),
          ),
        ),
      );

      await waitFor(() => expect(api.getFlags).toHaveBeenCalledWith(["telemetry_client"]));
      if (on) await waitFor(() => expect(telemetry.isAttached()).toBe(true));
      else {
        // Long enough for an idle load to have started, had the flag's answer let it.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(telemetry.isAttached()).toBe(false);
      }
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));

      if (on) {
        expect(load).toHaveBeenCalledOnce();
        expect(beacons.map(([url]) => url)).toEqual(["/api/telemetry"]);
        const names = beacons[0][1].events.map(({ name }) => name);
        expect(names).toEqual(["page_viewed", "page_speed_measured", "visit_ended"]);
        expect(beacons[0][1].events[0]).toMatchObject({
          route: "/games/chess/rooms/:code",
          is_landing: true,
        });
      } else {
        expect(load).not.toHaveBeenCalled();
        expect(beacons).toEqual([]);
      }
      expect(fetched).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});
