import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../app/ServicesProvider.jsx";
import { ADULT_SAFETY, fakeApi, MINOR_SAFETY } from "../testing/fakes.js";
import { SAFEST_FLAGS, useSafety } from "./useSafety.js";

const withApi = (api) =>
  function Wrapper({ children }) {
    return <ServicesProvider services={{ api }}>{children}</ServicesProvider>;
  };

describe("useSafety (CC-152)", () => {
  it("gives the safest flags until the server answers, then the player's own", async () => {
    let answer;
    const api = fakeApi({ getSafety: vi.fn(() => new Promise((resolve) => (answer = resolve))) });
    const { result } = renderHook(() => useSafety(), { wrapper: withApi(api) });

    expect(result.current).toEqual(expect.objectContaining({ status: "loading", safety: SAFEST_FLAGS }));
    await act(async () => answer(ADULT_SAFETY));

    expect(result.current).toEqual(expect.objectContaining({ status: "ready", safety: ADULT_SAFETY }));
  });

  it("keeps the safest flags when the server cannot answer", async () => {
    const api = fakeApi({ getSafety: vi.fn().mockRejectedValue(new Error("offline")) });
    const { result } = renderHook(() => useSafety(), { wrapper: withApi(api) });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.safety).toBe(SAFEST_FLAGS);
  });

  it("reads the flags again on reload, after the birth year is set", async () => {
    const api = fakeApi({
      getSafety: vi.fn().mockResolvedValueOnce(MINOR_SAFETY).mockResolvedValueOnce(ADULT_SAFETY),
    });
    const { result } = renderHook(() => useSafety(), { wrapper: withApi(api) });
    await waitFor(() => expect(result.current.safety).toEqual(MINOR_SAFETY));

    await act(() => result.current.reload());

    expect(result.current.safety).toEqual(ADULT_SAFETY);
  });

  it("is the same as the server's flags for an account of unknown age", () => {
    expect(SAFEST_FLAGS).toEqual(MINOR_SAFETY);
  });
});
