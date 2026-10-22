import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServicesContext } from "../app/servicesContext.js";
import { fakeApi, GUEST } from "../testing/fakes.js";
import { flagPaths } from "../testing/flagPaths.js";
import { SessionContext } from "./useSession.js";
import { browserTimeZone, useTimeZoneSync } from "./useTimeZoneSync.js";

// The browser tells the server its time zone (CC-146).
function wrapperFor(api, identity) {
  return function Wrapper({ children }) {
    return (
      <ServicesContext.Provider value={{ api }}>
        <SessionContext.Provider value={{ status: identity ? "ready" : "anonymous", identity }}>
          {children}
        </SessionContext.Provider>
      </ServicesContext.Provider>
    );
  };
}

const flags = (on) => vi.fn(async (names) => Object.fromEntries(names.map((name) => [name, on])));
const newYork = () => "America/New_York";

describe("useTimeZoneSync (CC-146)", () => {
  flagPaths("local_days", (on) => {
    it(on ? "sends the browser's zone once when it differs" : "sends nothing", async () => {
      const api = fakeApi({ getFlags: flags(on) });
      const { rerender } = renderHook(() => useTimeZoneSync({ zoneOf: newYork }), {
        wrapper: wrapperFor(api, GUEST),
      });
      if (on) {
        await waitFor(() => expect(api.setTimeZone).toHaveBeenCalledWith("America/New_York"));
        rerender();
        await waitFor(() => expect(api.getTimeZone).toHaveBeenCalledTimes(1));
        expect(api.setTimeZone).toHaveBeenCalledTimes(1);
      } else {
        await waitFor(() => expect(api.getFlags).toHaveBeenCalled());
        expect(api.getTimeZone).not.toHaveBeenCalled();
        expect(api.setTimeZone).not.toHaveBeenCalled();
      }
    });
  });

  it("sends nothing when the server already has the zone", async () => {
    const api = fakeApi({
      getFlags: flags(true),
      getTimeZone: vi.fn().mockResolvedValue({ zone: "America/New_York", chosen: true }),
    });
    renderHook(() => useTimeZoneSync({ zoneOf: newYork }), { wrapper: wrapperFor(api, GUEST) });
    await waitFor(() => expect(api.getTimeZone).toHaveBeenCalled());
    expect(api.setTimeZone).not.toHaveBeenCalled();
  });

  it("stays quiet when the change is refused", async () => {
    const api = fakeApi({
      getFlags: flags(true),
      setTimeZone: vi.fn().mockRejectedValue(Object.assign(new Error("locked"), { status: 409 })),
    });
    renderHook(() => useTimeZoneSync({ zoneOf: newYork }), { wrapper: wrapperFor(api, GUEST) });
    await waitFor(() => expect(api.setTimeZone).toHaveBeenCalledTimes(1));
  });

  it("reads the browser's own zone by default", () => {
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(browserTimeZone()).not.toBe("");
  });

  it("waits for a player", async () => {
    const api = fakeApi({ getFlags: flags(true) });
    renderHook(() => useTimeZoneSync({ zoneOf: newYork }), { wrapper: wrapperFor(api, undefined) });
    await waitFor(() => expect(api.getFlags).toHaveBeenCalled());
    expect(api.getTimeZone).not.toHaveBeenCalled();
  });
});
