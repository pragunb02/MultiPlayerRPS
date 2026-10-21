import { render } from "@testing-library/react";
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { endpointOf } from "@classicade/shared";
import { ErrorBoundary } from "../../app/ErrorBoundary.jsx";
import { recoverFromStaleBuild } from "../../app/staleBuild.js";
import { createApiClient } from "../api.js";
import { AppRequestError } from "../errors.js";
import { createSocketClient } from "../socket.js";
import { codeOf, countRenderErrors, errorTypeOf, socketCodeOf } from "./errorFields.js";
import { createTelemetryFacade } from "./facade.js";
import { startTelemetry } from "./index.js";

const SECRET = "riya@example.com lost room AB2CD3";

/** A facade with a recording client attached, as the app has once counts are on. */
function recording() {
  const tracked = [];
  const facade = createTelemetryFacade({ isOff: () => false });
  const recorder = { track: (name, fields) => tracked.push([name, fields]), stop: () => {} };
  facade.attach(recorder);
  return { facade, tracked, recorder };
}

afterEach(() => vi.unstubAllGlobals());

describe("errors and the connection (CC-174, EVENTS.md 3.5)", () => {
  // AC-7 (CC-174)
  it("errors carry the type, never the message", async () => {
    const { facade, tracked, recorder } = recording();

    // A render error, through the error boundary.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = () => {
      throw new TypeError(SECRET);
    };
    render(h(ErrorBoundary, { onError: countRenderErrors(facade) }, h(Broken)));

    // A part that failed to load right after a reload, through the stale build guard.
    const address = {
      href: "https://nocapgaming.onrender.com/?reloaded=1",
      pathname: "/",
      search: "?reloaded=1",
      hash: "",
    };
    const listeners = {};
    const fakeWindow = {
      location: {
        get href() {
          return address.href;
        },
        reload: () => {},
      },
      history: {
        state: null,
        replaceState: (state, title, path) => (address.href = `https://nocapgaming.onrender.com${path}`),
      },
      addEventListener: (type, listener) => (listeners[type] = listener),
      removeEventListener: () => {},
    };
    recoverFromStaleBuild({
      window: fakeWindow,
      now: () => 0,
      onFailedLoad: (kind) => facade.track("client_errored", { kind, error_type: "other" }),
    });
    listeners["vite:preloadError"]({ preventDefault: () => {} });

    // A failed API call and a call with no answer at all.
    const api = createApiClient({
      fetchImpl: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          json: async () => ({ error: { code: "NOT_FOUND", message: SECRET } }),
        })
        .mockRejectedValueOnce(new TypeError(SECRET)),
      onFailure: ({ path, status, error }) =>
        facade.track("request_failed", { endpoint: endpointOf(`/api${path}`), status, code: codeOf(error) }),
    });
    await expect(api.getMatch("m_AB2CD3")).rejects.toThrow(AppRequestError);
    await expect(api.getMatch("m_AB2CD3")).rejects.toThrow(AppRequestError);

    // The realtime connection dropping and coming back.
    const handlers = {};
    const socket = { on: (event, handler) => (handlers[event] = handler), connect: () => {} };
    let clock = 0;
    createSocketClient({
      connect: () => socket,
      now: () => clock,
      onChange: ({ state, reason, afterS }) =>
        facade.track("socket_changed", {
          state,
          code: socketCodeOf(reason),
          ...(afterS && { after_s: afterS }),
        }),
    });
    handlers.disconnect("transport close");
    clock = 25_000;
    handlers.connect();
    handlers.connect_error(
      Object.assign(new Error(SECRET), { data: { code: "RATE_LIMITED", message: SECRET } }),
    );

    // An unhandled rejection, through the started client.
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: () => true });
    const started = startTelemetry({
      window,
      facade,
      isOff: () => false,
      build: "0.1.0+abc1234",
      strict: true,
      wasWaking: false,
      onAccepted: () => {},
    });
    // The started client took over the facade. The recorder takes it back, to see what the listener sends.
    facade.attach(recorder);
    const rejection = new Event("unhandledrejection");
    rejection.reason = new RangeError(SECRET);
    window.dispatchEvent(rejection);
    started.stop();

    expect(tracked).toEqual([
      ["client_errored", { kind: "render", error_type: "TypeError" }],
      ["client_errored", { kind: "stale_build_reload", error_type: "other" }],
      ["client_errored", { kind: "chunk_load", error_type: "other" }],
      ["request_failed", { endpoint: "/api/matches/:matchId", status: 404, code: "NOT_FOUND" }],
      ["request_failed", { endpoint: "/api/matches/:matchId", status: 0, code: "network" }],
      ["socket_changed", { state: "dropped", code: "transport_close" }],
      ["socket_changed", { state: "restored", code: "transport_close", after_s: "10-60" }],
      ["socket_changed", { state: "connect_failed", code: "RATE_LIMITED" }],
      ["client_errored", { kind: "unhandled", error_type: "RangeError" }],
    ]);
    const sent = JSON.stringify(tracked);
    expect(sent).not.toContain("riya");
    expect(sent).not.toContain("AB2CD3");
  });

  it("reads an error's name, so DOM errors and a minified class still get their type (owner review 2026-10-21)", () => {
    // A production build renames classes, but AppRequestError sets its own name.
    class Q extends Error {
      constructor() {
        super(SECRET);
        this.name = "AppRequestError";
      }
    }

    expect(errorTypeOf(new DOMException(SECRET, "AbortError"))).toBe("AbortError");
    expect(errorTypeOf(new DOMException(SECRET, "QuotaExceededError"))).toBe("QuotaExceededError");
    expect(errorTypeOf(new Q())).toBe("AppRequestError");
    expect(errorTypeOf(new AppRequestError({ code: "NOT_FOUND", message: SECRET }))).toBe("AppRequestError");
  });

  it("an error type off the list, or something thrown that is not an error, is other", () => {
    const named = Object.assign(new Error("x"), { name: "SecretRiyaError" });

    expect(errorTypeOf(named)).toBe("other");
    expect(errorTypeOf(SECRET)).toBe("other");
    expect(errorTypeOf({ name: "TypeError" })).toBe("other");
    expect(codeOf({ code: SECRET })).toBe("unknown");
    expect(codeOf({ code: "TIMEOUT" })).toBe("timeout");
    expect(socketCodeOf("something new")).toBe("other");
    expect(socketCodeOf(new Error(SECRET))).toBe("connect_error");
  });
});
