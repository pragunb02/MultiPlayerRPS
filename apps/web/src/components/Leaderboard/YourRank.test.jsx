import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const USER = Object.freeze({ kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "riya" });
const PROGRESS = {
  xp: 0,
  level: 1,
  xpIntoLevel: 0,
  xpForNextLevel: 50,
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
};

function openProfile({ identity, getLeaderboard }) {
  const api = fakeApi({
    getSession: async () => identity,
    getProgress: async () => PROGRESS,
    getMatches: async () => ({ matches: [] }),
    ...(getLeaderboard && { getLeaderboard }),
  });
  renderApp({ path: "/profile", api });
  return api;
}
const card = async () => screen.findByRole("region", { name: "Your rank" });

describe("Your rank on the profile", () => {
  it("shows an account's place on the overall and weekly boards", async () => {
    const getLeaderboard = vi.fn(async (id) => ({
      board: { id },
      entries: [],
      you: id === "overall" ? { listed: true, rank: 3, score: 900 } : { listed: false, reason: "unranked" },
    }));
    openProfile({ identity: USER, getLeaderboard });

    const rank = await card();

    expect(await within(rank).findByText("#3")).toBeInTheDocument();
    expect(await within(rank).findByText("Unranked")).toBeInTheDocument();
    expect(getLeaderboard).toHaveBeenCalledWith("overall", { limit: 1 });
    expect(getLeaderboard).toHaveBeenCalledWith("weekly", { limit: 1 });
    expect(within(rank).getByRole("link", { name: "See the leaderboards" })).toHaveAttribute(
      "href",
      "/leaderboards/overall",
    );
  });

  it("shows a dash when a rank could not be loaded", async () => {
    const failure = new AppRequestError({ code: "NETWORK", message: "offline" });
    openProfile({ identity: USER, getLeaderboard: vi.fn().mockRejectedValue(failure) });

    const rank = await card();

    expect(await within(rank).findAllByText("—")).toHaveLength(2);
  });

  it("shows a guest its place too, and asks it to sign up to keep it (ADR-060)", async () => {
    const getLeaderboard = vi.fn(async (id) => ({
      board: { id },
      entries: [],
      you: id === "weekly" ? { listed: true, rank: 7, score: 40 } : { listed: false, reason: "unranked" },
    }));
    openProfile({ identity: GUEST, getLeaderboard });

    const rank = await card();

    expect(await within(rank).findByText("#7")).toBeInTheDocument();
    expect(await within(rank).findByText("Unranked")).toBeInTheDocument();
    expect(within(rank).getByText(/to keep your place/)).toHaveTextContent(
      "Sign up to keep your place on the boards.",
    );
    expect(within(rank).getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup?next=%2Fprofile",
    );
  });

  it("never asks an account to sign up", async () => {
    const getLeaderboard = vi.fn(async (id) => ({ board: { id }, entries: [], you: { listed: false, reason: "unranked" } }));
    openProfile({ identity: USER, getLeaderboard });

    const rank = await card();

    expect(await within(rank).findAllByText("Unranked")).toHaveLength(2);
    expect(within(rank).queryByText(/keep your place/)).not.toBeInTheDocument();
  });
});
