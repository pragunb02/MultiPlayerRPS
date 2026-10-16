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

  it("asks a guest to sign up instead, without loading any board", async () => {
    const api = openProfile({ identity: GUEST });

    const rank = await card();

    expect(within(rank).getByText(/Guests aren't ranked/)).toBeInTheDocument();
    expect(within(rank).getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup?next=%2Fprofile",
    );
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });
});
