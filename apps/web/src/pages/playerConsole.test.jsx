import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, GUEST } from "../testing/fakes.js";
import { renderApp } from "../testing/render.jsx";

const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const PROGRESS = {
  xp: 60,
  level: 2,
  xpIntoLevel: 10,
  xpForNextLevel: 100,
  matchesPlayed: 2,
  wins: 2,
  losses: 0,
  draws: 0,
};
const profileApi = (identity) =>
  fakeApi({
    getSession: async () => identity,
    getProgress: async () => PROGRESS,
    getMatches: async () => ({ matches: [] }),
  });

describe("player console on the profile (CC-054, CC-089)", () => {
  it("shows streaks, today's quests and achievements", async () => {
    renderApp({ path: "/profile", api: profileApi(USER) });

    const panel = await screen.findByRole("region", { name: "Player console" });
    expect(within(panel).getByRole("heading", { name: "Streaks" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Daily quests" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Achievements" })).toBeInTheDocument();
    expect(await within(panel).findByText("0/3 done")).toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: /Sign up to keep/ })).toBeNull();
  });

  it("nudges a guest to sign up to keep what they earned, and comes back to the profile", async () => {
    renderApp({ path: "/profile", api: profileApi(GUEST) });

    expect(
      await screen.findByRole("link", { name: "Sign up to keep your streak and achievements" }),
    ).toHaveAttribute("href", "/signup?next=%2Fprofile");
  });
});

describe("daily quests on the home page", () => {
  it("shows today's quests once there is a player", async () => {
    renderApp({ api: fakeApi({ getSession: async () => GUEST }) });

    const quests = await screen.findByRole("region", { name: "Daily quests" });
    expect(await within(quests).findByRole("list", { name: "Today's quests" })).toBeInTheDocument();
  });

  it("shows no quests to a visitor without a session", async () => {
    const api = fakeApi();
    renderApp({ api });
    await screen.findByRole("button", { name: "Play as a guest" });

    expect(screen.queryByRole("region", { name: "Daily quests" })).toBeNull();
    expect(api.getQuests).not.toHaveBeenCalled();
  });
});
