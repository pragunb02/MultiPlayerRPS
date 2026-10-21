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
function renderStub({ path = "/games/chess/rooms/AB2CD3", identity, loadHost, api = fakeApi() } = {}) {
  const idle = [];
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn((run) => idle.push(run)),
  );
  const telemetry = createTelemetryFacade({ isOff: () => false, landing: { entry: "room_link", via: "" } });
  const view = render(
    h(
      MemoryRouter,
      { initialEntries: [path] },
      h(
        ServicesContext.Provider,
        { value: { api, telemetry } },
        h(
          SessionContext.Provider,
          { value: { status: identity ? "ready" : "anonymous", identity } },
          h(TelemetryStub, { loadHost }),
        ),
      ),
    ),
  );
  const runIdle = () => act(() => idle.splice(0).forEach((run) => run()));
  return { telemetry, view, idle, runIdle };
}

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
