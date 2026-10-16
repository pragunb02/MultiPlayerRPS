import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, fakeSocket, GUEST, PROGRESS } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const header = () => within(screen.getByRole("banner"));
const progress = (overrides) => ({ ...PROGRESS, ...overrides });

describe("LevelChip (header)", () => {
  it("shows a signed-in player's level and XP to the next level", async () => {
    renderApp({
      api: fakeApi({
        getSession: async () => GUEST,
        getProgress: async () => progress({ xp: 60, level: 2, xpIntoLevel: 10, xpForNextLevel: 100 }),
      }),
    });

    const bar = await header().findByRole("progressbar", { name: "Level 2: 10 of 100 XP to the next level" });
    expect(bar).toHaveAttribute("max", "100");
    expect(bar).toHaveAttribute("value", "10");
    expect(header().getByText("Lv 2")).toHaveAttribute("aria-hidden", "true");
  });

  it("follows the XP the server pushes after each match", async () => {
    const socket = fakeSocket();
    renderApp({ socket, api: fakeApi({ getSession: async () => GUEST }) });
    await header().findByRole("progressbar", { name: /^Level 1:/ });

    act(() =>
      socket.push("progress:updated", {
        xpGained: 30,
        leveledUp: true,
        progress: progress({ xp: 60, level: 2, xpIntoLevel: 10, xpForNextLevel: 100 }),
      }),
    );

    const bar = header().getByRole("progressbar", { name: "Level 2: 10 of 100 XP to the next level" });
    expect(bar).toHaveClass("gained");
  });

  it("shows a full bar at the highest level", async () => {
    renderApp({
      api: fakeApi({
        getSession: async () => GUEST,
        getProgress: async () => progress({ level: 100, xpIntoLevel: 0, xpForNextLevel: 0 }),
      }),
    });

    const bar = await header().findByRole("progressbar", { name: "Level 100, the highest level" });
    expect(bar).toHaveAttribute("max", "1");
    expect(bar).toHaveAttribute("value", "1");
  });

  it("is not there for visitors without a session, and asks for no progress", async () => {
    const { api } = renderApp();
    await header().findByRole("link", { name: "Log in" });

    expect(header().queryByRole("progressbar")).toBeNull();
    expect(api.getProgress).not.toHaveBeenCalled();
  });

  it("stays out of the way when progress can't be loaded", async () => {
    renderApp({
      api: fakeApi({
        getSession: async () => GUEST,
        getProgress: async () => Promise.reject(new Error("down")),
      }),
    });
    await header().findByText(GUEST.displayName);

    expect(header().queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
