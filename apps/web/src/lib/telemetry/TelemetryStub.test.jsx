import { act, render, waitFor } from "@testing-library/react";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesContext } from "../../app/servicesContext.js";
import { SessionContext } from "../../hooks/useSession.js";
import { fakeApi } from "../../testing/fakes.js";
import { createTelemetryFacade } from "./facade.js";
import { TelemetryStub } from "./TelemetryStub.jsx";

afterEach(() => vi.unstubAllGlobals());

const GUEST = { kind: "guest", id: "guest_x", displayName: "Guest-T001" };

/** The stub in an app at `path`, with the browser's idle moments held until a test lets them run. */
function renderStub({
  path = "/games/chess/rooms/AB2CD3",
  identity,
  status = identity ? "ready" : "anonymous",
  loadHost,
  api = fakeApi(),
  quietly,
} = {}) {
  const idle = [];
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn((run) => idle.push(run)),
  );
  const telemetry = createTelemetryFacade({
    isOff: () => false,
    landing: { entry: "room_link", via: "" },
    ...(quietly && { quietly }),
  });
  const tree = (session) =>
    h(
      MemoryRouter,
      { initialEntries: [path] },
      h(
        ServicesContext.Provider,
        { value: { api, telemetry } },
        h(SessionContext.Provider, { value: session }, h(TelemetryStub, { loadHost })),
      ),
    );
  const view = render(tree({ status, identity }));
  const runIdle = () => act(() => idle.splice(0).forEach((run) => run()));
  /** The session's answer arrives. */
  const settle = (next) => view.rerender(tree(next));
  return { telemetry, view, idle, runIdle, settle };
}

const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("the stub while the session is still asked (review of #161)", () => {
  it("counts the landing view and what was held early with the kind of player the session settles on", async () => {
    const loadHost = vi.fn(() => new Promise(() => {}));
    const { telemetry, settle, runIdle } = renderStub({ status: "loading", loadHost });
    telemetry.track("client_errored", { kind: "render", error_type: "TypeError" });
    await tick();
    runIdle();

    // Nothing counts as a page view, and the host does not load, until the session says who this is.
    expect(loadHost).not.toHaveBeenCalled();
    settle({ status: "ready", identity: GUEST });
    await tick();
    const sink = { track: vi.fn(), stop: vi.fn() };
    telemetry.attach(sink);

    expect(sink.track.mock.calls).toEqual([
      [
        "client_errored",
        { kind: "render", error_type: "TypeError" },
        { path: "/games/chess/rooms/AB2CD3", playerKind: "guest" },
      ],
      [
        "page_viewed",
        { is_landing: true, entry: "room_link" },
        { path: "/games/chess/rooms/AB2CD3", playerKind: "guest" },
      ],
    ]);
    runIdle();
    expect(loadHost).toHaveBeenCalledOnce();
  });

  it("counts the view once per address, and keeps the last kind while the session is asked again", async () => {
    const loadHost = vi.fn(() => new Promise(() => {}));
    const { telemetry, settle } = renderStub({ identity: GUEST, loadHost });
    await tick();
    settle({ status: "loading", identity: undefined });
    await tick();
    settle({ status: "error", identity: undefined });
    await tick();
    const sink = { track: vi.fn(), stop: vi.fn() };
    telemetry.attach(sink);

    expect(sink.track.mock.calls.map(([name]) => name)).toEqual(["page_viewed"]);
    expect(telemetry.context()).toEqual({ path: "/games/chess/rooms/AB2CD3", playerKind: "visitor" });
  });
});

describe("the stub when the host's file fails to download (review of #161)", () => {
  it("never reloads the tab for it, catches the failure and tries once more when idle", async () => {
    const quietly = vi.fn((run) => run());
    const loadHost = vi.fn().mockRejectedValue(new TypeError("Failed to fetch dynamically imported module"));
    const { runIdle } = renderStub({ loadHost, quietly });
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);

    runIdle();
    await tick();
    runIdle();
    await tick();
    runIdle();
    await tick();
    window.removeEventListener("unhandledrejection", unhandled);

    expect(loadHost).toHaveBeenCalledTimes(2);
    expect(quietly).toHaveBeenCalledTimes(2);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe("the first page's telemetry stub (CC-174, CC-322)", () => {
  it("tells the facade the address and the kind of player, and holds the first page view", async () => {
    const loadHost = vi.fn(() => new Promise(() => {}));
    const { telemetry } = renderStub({ identity: GUEST, loadHost });

    expect(telemetry.context()).toEqual({ path: "/games/chess/rooms/AB2CD3", playerKind: "guest" });
    const sink = { track: vi.fn(), stop: vi.fn() };
    await new Promise((resolve) => setTimeout(resolve, 0));
    telemetry.attach(sink);

    expect(sink.track).toHaveBeenCalledWith(
      "page_viewed",
      { is_landing: true, entry: "room_link" },
      { path: "/games/chess/rooms/AB2CD3", playerKind: "guest" },
    );
  });

  it("names an account and a visitor as such", () => {
    const loadHost = vi.fn(() => new Promise(() => {}));
    expect(
      renderStub({ identity: { kind: "user", id: "u1" }, loadHost }).telemetry.context().playerKind,
    ).toBe("account");
    expect(renderStub({ loadHost }).telemetry.context().playerKind).toBe("visitor");
  });

  it("loads the host only once the browser is idle, then hands it the held counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 204 })),
    );
    const beacons = [];
    vi.stubGlobal("navigator", {
      ...navigator,
      sendBeacon: (url, body) => beacons.push(JSON.parse(body)) > 0,
    });
    const loadHost = vi.fn(() => import("./TelemetryHost.jsx"));
    const api = fakeApi({ getFlags: vi.fn(async () => ({ telemetry_client: true })) });
    const { telemetry, runIdle } = renderStub({ loadHost, api });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loadHost).not.toHaveBeenCalled();
    expect(telemetry.isAttached()).toBe(false);
    runIdle();
    expect(loadHost).toHaveBeenCalledOnce();
    // The host waits for an idle moment of its own before the client's file.
    await waitFor(() => expect(api.getFlags).toHaveBeenCalledWith(["telemetry_client"]));
    await waitFor(() => {
      runIdle();
      expect(telemetry.isAttached()).toBe(true);
    });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));

    const viewed = beacons.flatMap(({ events }) => events).filter(({ name }) => name === "page_viewed");
    expect(viewed).toEqual([
      expect.objectContaining({ route: "/games/chess/rooms/:code", is_landing: true, entry: "room_link" }),
    ]);
  });

  it("counts each new page once its address settles, and stops counting when it goes", async () => {
    const loadHost = vi.fn(() => new Promise(() => {}));
    const { telemetry, view } = renderStub({ path: "/", loadHost });
    const sink = { track: vi.fn(), stop: vi.fn() };
    telemetry.attach(sink);
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sink.track).not.toHaveBeenCalled();
  });
});
