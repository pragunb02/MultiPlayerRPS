import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeSocket, fakeSound } from "../testing/fakes.js";
import { installMatchMedia } from "../testing/matchMedia.js";
import { renderApp } from "../testing/render.jsx";
import { BURST_MS } from "./ProgressToasts.jsx";

const burst = () => document.querySelector("[data-effect='level-up']");
const levelUp = (level) => ({ xpGained: 30, leveledUp: true, progress: { level } });

describe("ProgressToasts level-up burst", () => {
  afterEach(() => vi.useRealTimers());

  it("bursts behind the new level, says it in words, and clears itself", async () => {
    const socket = fakeSocket();
    const sound = fakeSound();
    renderApp({ socket, sound });
    await screen.findByRole("heading", { name: /Play the classics/ });
    vi.useFakeTimers();

    act(() => socket.push("progress:updated", levelUp(3)));

    expect(sound.played).toEqual(["level-up"]);
    expect(burst()).toHaveTextContent("3");
    expect(screen.getByRole("status")).toHaveTextContent("Level up! You reached level 3");
    act(() => vi.advanceTimersByTime(BURST_MS));
    expect(burst()).toBeNull();
  });

  it("restarts for a second level-up that comes before the first burst ends", async () => {
    const socket = fakeSocket();
    renderApp({ socket });
    await screen.findByRole("heading", { name: /Play the classics/ });

    act(() => socket.push("progress:updated", levelUp(2)));
    act(() => socket.push("progress:updated", levelUp(3)));

    expect(document.querySelectorAll("[data-effect='level-up']")).toHaveLength(1);
    expect(burst()).toHaveTextContent("3");
  });

  it("has no burst under reduced motion; the toast still says it", async () => {
    installMatchMedia({ reducedMotion: true });
    const socket = fakeSocket();
    renderApp({ socket });
    await screen.findByRole("heading", { name: /Play the classics/ });

    act(() => socket.push("progress:updated", levelUp(2)));

    expect(burst()).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Level up! You reached level 2");
  });

  it("does not burst for XP without a level-up", async () => {
    const socket = fakeSocket();
    const sound = fakeSound();
    renderApp({ socket, sound });
    await screen.findByRole("heading", { name: /Play the classics/ });

    act(() => socket.push("progress:updated", { xpGained: 30, leveledUp: false, progress: { level: 1 } }));

    expect(burst()).toBeNull();
    expect(sound.played).toEqual([]);
  });

  it("says why a match didn't count, instead of XP (CC-095)", async () => {
    const socket = fakeSocket();
    renderApp({ socket });
    await screen.findByRole("heading", { name: /Play the classics/ });

    act(() =>
      socket.push("progress:updated", {
        source: "match",
        xpGained: 0,
        leveledUp: false,
        progress: { level: 1 },
        counted: false,
        notCountedReason: "opponent-daily-limit",
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "This game didn't count: daily limit with this opponent reached",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("XP");
  });
});
