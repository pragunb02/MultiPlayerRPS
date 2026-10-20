import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServicesContext } from "../app/servicesContext.js";
import { fakeApi, GUEST } from "../testing/fakes.js";
import { useFlag } from "./useFlag.js";
import { SessionContext } from "./useSession.js";

// The web side of feature flags (CC-312): a component asks for one flag and gets a boolean, off until the server
// says otherwise.
const OWNER = Object.freeze({ kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Owner" });

function wrapperFor(api, session) {
  return function Wrapper({ children }) {
    return (
      <ServicesContext.Provider value={{ api }}>
        <SessionContext.Provider value={session.current}>{children}</SessionContext.Provider>
      </ServicesContext.Provider>
    );
  };
}

const sessionOf = (identity) => ({ current: { status: identity ? "ready" : "anonymous", identity } });

describe("useFlag (CC-312)", () => {
  it("is off until the server answers, then follows the answer", async () => {
    let answer;
    const api = fakeApi({ getFlags: vi.fn(() => new Promise((resolve) => (answer = resolve))) });

    const { result } = renderHook(() => useFlag("console_flag_check"), {
      wrapper: wrapperFor(api, sessionOf(OWNER)),
    });

    expect(result.current).toBe(false);
    answer({ console_flag_check: true });
    await waitFor(() => expect(result.current).toBe(true));
    expect(api.getFlags).toHaveBeenCalledWith(["console_flag_check"]);
  });

  it("asks for a visitor with no session too, and follows the answer", async () => {
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ console_flag_check: true }) });

    const { result } = renderHook(() => useFlag("console_flag_check"), {
      wrapper: wrapperFor(api, sessionOf(undefined)),
    });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays off when the question fails", async () => {
    const api = fakeApi({ getFlags: vi.fn().mockRejectedValue(new Error("offline")) });

    const { result } = renderHook(() => useFlag("console_flag_check"), {
      wrapper: wrapperFor(api, sessionOf(GUEST)),
    });

    await waitFor(() => expect(api.getFlags).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("asks again when the player changes, and forgets the old answer meanwhile", async () => {
    const api = fakeApi({ getFlags: vi.fn().mockResolvedValue({ console_flag_check: true }) });
    const session = sessionOf(OWNER);

    const { result, rerender } = renderHook(() => useFlag("console_flag_check"), {
      wrapper: wrapperFor(api, session),
    });
    await waitFor(() => expect(result.current).toBe(true));

    api.getFlags.mockReturnValue(new Promise(() => {}));
    session.current = sessionOf(GUEST).current;
    rerender();

    expect(result.current).toBe(false);
    expect(api.getFlags).toHaveBeenCalledTimes(2);
  });

  it("an unknown flag name throws", () => {
    const api = fakeApi();
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      renderHook(() => useFlag("no_such_flag"), { wrapper: wrapperFor(api, sessionOf(GUEST)) }),
    ).toThrow(/Unknown feature flag "no_such_flag"/);
    expect(api.getFlags).not.toHaveBeenCalled();
  });
});
