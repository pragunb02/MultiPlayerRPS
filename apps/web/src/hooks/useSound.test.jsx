import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServicesProvider } from "../app/ServicesProvider.jsx";
import { fakeSound } from "../testing/fakes.js";
import { useLowTimeTick, useSound, useSoundSettings } from "./useSound.js";

const withSound = (sound) =>
  function Wrapper({ children }) {
    return <ServicesProvider services={{ sound }}>{children}</ServicesProvider>;
  };

describe("useSound (CC-103)", () => {
  it("hands out the injected sound player", () => {
    const sound = fakeSound();

    const { result } = renderHook(() => useSound(), { wrapper: withSound(sound) });

    expect(result.current).toBe(sound);
  });

  it("follows every change of the settings", () => {
    const sound = fakeSound();
    const { result } = renderHook(() => useSoundSettings(), { wrapper: withSound(sound) });
    expect(result.current).toEqual({ muted: false, volume: 0.6 });

    act(() => sound.setMuted(true));

    expect(result.current).toEqual({ muted: true, volume: 0.6 });
  });
});

describe("useLowTimeTick (CC-103)", () => {
  function Clock({ msLeft, running }) {
    useLowTimeTick(msLeft, running);
    return null;
  }
  const mount = (sound, props) => render(<Clock {...props} />, { wrapper: withSound(sound) });

  it("ticks once for every second under ten seconds while your clock runs", () => {
    const sound = fakeSound();
    const view = mount(sound, { msLeft: 10_500, running: true });
    expect(sound.played).toEqual([]);

    for (const msLeft of [9_900, 9_500, 9_000, 8_400, 7_900]) {
      view.rerender(<Clock msLeft={msLeft} running />);
    }

    // The clock shows whole seconds rounded up: 9.9 s and 9.5 s both read 10, and 9.0 s and 8.4 s both read 9.
    expect(sound.played).toEqual(["low-time", "low-time", "low-time"]);
  });

  it("stays quiet while the clock is stopped and once it ran out", () => {
    const sound = fakeSound();
    const view = mount(sound, { msLeft: 5_000, running: false });
    view.rerender(<Clock msLeft={4_000} running={false} />);
    view.rerender(<Clock msLeft={0} running />);

    expect(sound.played).toEqual([]);
  });

  it("starts ticking again when your clock runs once more after a move", () => {
    const sound = fakeSound();
    const view = mount(sound, { msLeft: 5_000, running: true });
    view.rerender(<Clock msLeft={5_000} running={false} />);
    view.rerender(<Clock msLeft={5_000} running />);

    expect(sound.played).toEqual(["low-time", "low-time"]);
  });
});
