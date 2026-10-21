import { afterEach, describe, expect, it, vi } from "vitest";
import { TELEMETRY_BATCH } from "./client.js";
import { createTelemetryFacade } from "./facade.js";
import { startTelemetry } from "./index.js";
import { routeOf } from "./routeOf.js";

const BUILD = "0.1.0+abc1234";
const visibility = (state) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  visibility("visible");
  document.body.innerHTML = "";
});

function start({ beacon = true, surfaceOf } = {}) {
  const beacons = [];
  const fetched = vi.fn(async () => ({ status: 204 }));
  vi.stubGlobal("fetch", fetched);
  vi.stubGlobal(
    "navigator",
    beacon
      ? { ...navigator, sendBeacon: (url, body) => beacons.push(JSON.parse(body)) > 0 }
      : { ...navigator },
  );
  const facade = createTelemetryFacade({ isOff: () => false });
  facade.setContext({ path: "/", playerKind: "guest" });
  const onAccepted = vi.fn();
  const started = startTelemetry({
    window,
    facade,
    isOff: () => false,
    routeOf,
    build: BUILD,
    strict: true,
    wasWaking: false,
    onAccepted,
    ...(surfaceOf && { surfaceOf }),
  });
  return { facade, started, beacons, fetched, onAccepted };
}

describe("the hand-over from the first page's stub (CC-174, CC-322)", () => {
  it("sends the counts held before it loaded, each at the screen it happened on, with the fields it fills", () => {
    const beacons = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      sendBeacon: (url, body) => beacons.push(JSON.parse(body)) > 0,
    });
    const held = createTelemetryFacade({ isOff: () => false });
    // Before the client loads: the first page's render error, a failed request and the first page view.
    held.track("client_errored", { kind: "render", error_type: "TypeError" });
    held.setContext({ path: "/games/chess/rooms/AB2CD3", playerKind: "guest" });
    held.track("request_failed", ({ endpointOf }) => ({
      endpoint: endpointOf("/api/matches/abc?x=1"),
      status: 500,
      code: "unknown",
    }));
    held.track("page_viewed", { is_landing: true, entry: "room_link" });
    held.setContext({ path: "/no/such/page", playerKind: "account" });
    held.track("page_viewed", { is_landing: false });

    const started = startTelemetry({
      window,
      facade: held,
      isOff: () => false,
      routeOf,
      build: BUILD,
      strict: true,
      wasWaking: false,
      onAccepted: () => {},
    });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));

    const events = beacons
      .flatMap(({ events: sent }) => sent)
      .filter(({ name }) => name !== "page_speed_measured");
    expect(events.map(({ name, route, player_kind: kind }) => [name, route, kind])).toEqual([
      ["client_errored", "not_found", "visitor"],
      ["request_failed", "/games/chess/rooms/:code", "guest"],
      ["page_viewed", "/games/chess/rooms/:code", "guest"],
      ["page_viewed", "not_found", "account"],
    ]);
    expect(events[1]).toMatchObject({ endpoint: "/api/matches/:matchId", status: 500, code: "unknown" });
    expect(JSON.stringify(events)).not.toMatch(/AB2CD3|abc/);
    started.stop();
  });
});

describe("the started client (CC-174)", () => {
  it("posts a full batch as JSON to our own server, with the session cookie, and tells when it was taken", async () => {
    const { facade, started, fetched, onAccepted } = start();

    for (let index = 0; index < TELEMETRY_BATCH.maxEvents; index += 1) {
      facade.track("control_pressed", { control: "home.play_guest", has_reason: false });
    }
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());

    const [[url, init]] = fetched.mock.calls;
    expect(url).toBe("/api/telemetry");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(init.body).events).toHaveLength(20);
    started.stop();
  });

  it("sends what is queued when the page is hidden, and counts only visible time when it is left", () => {
    vi.useFakeTimers();
    const { facade, started, beacons } = start();

    facade.track("control_pressed", { control: "home.play_guest", has_reason: false });
    visibility("hidden");
    expect(beacons.flatMap(({ events }) => events.map(({ name }) => name))).toEqual([
      "control_pressed",
      "page_speed_measured",
    ]);
    vi.advanceTimersByTime(60_000);
    visibility("visible");
    vi.advanceTimersByTime(5_000);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));

    const ended = beacons.flatMap(({ events }) => events).find(({ name }) => name === "visit_ended");
    expect(ended).toMatchObject({ active_s: "0-10", presses: "0" });
    started.stop();
  });

  it("does not end the visit for a page kept in the back and forward cache, and drops a batch without sendBeacon", () => {
    const { facade, started, beacons } = start();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(beacons.flatMap(({ events }) => events).map(({ name }) => name)).toEqual(["page_speed_measured"]);
    started.stop();

    const bare = start({ beacon: false });
    bare.facade.track("control_pressed", { control: "home.play_guest", has_reason: false });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    expect(bare.beacons).toEqual([]);
    bare.started.stop();
    expect(facade.isAttached()).toBe(false);
  });

  it("passes the interruption a press landed in to the press watcher (CC-313's slot)", () => {
    document.body.innerHTML = `<main><button data-cc-control="toast.action">Undo</button></main>`;
    const { facade, started, beacons } = start({ surfaceOf: () => "toast.xp" });
    const surfaces = [];
    facade.attach({
      track: (name, fields) => surfaces.push([name, fields]),
      stop: () => {},
    });

    document.querySelector("button").dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));

    expect(surfaces[0]).toEqual([
      "control_pressed",
      { control: "toast.action", has_reason: false, surface: "toast.xp" },
    ]);
    started.stop();
    expect(beacons).toEqual([]);
  });
});
