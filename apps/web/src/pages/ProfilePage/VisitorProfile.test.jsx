import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "@classicade/shared";
import { fakeApi, PROGRESS } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

/** The words a screen reader reads for an element: its text without the parts hidden from it. */
const heard = (element) => {
  const copy = element.cloneNode(true);
  copy.querySelectorAll("[aria-hidden='true']").forEach((hidden) => hidden.remove());
  return copy.textContent;
};
const preview = () => screen.getByRole("list", { name: "What your card will show" });
const openProfile = async (api = fakeApi()) => {
  const app = renderApp({ path: "/profile", api });
  await screen.findByRole("heading", { level: 1, name: "Your profile" });
  return app;
};

describe("the profile for a visitor without a session (CC-259)", () => {
  it("says what the page is and how it fills", async () => {
    await openProfile();

    expect(screen.getByText("Your arcade card starts with your first game.")).toBeInTheDocument();
  });

  it("previews level 1, the streak and the first three achievements of the catalog, all still to earn", async () => {
    await openProfile();

    expect(screen.getByText("Level 1")).toBeInTheDocument();
    expect(screen.getByText("Rookie rank, 0 XP so far")).toBeInTheDocument();
    expect(within(preview()).getAllByRole("listitem").map(heard)).toEqual([
      "Daily streak",
      ...ACHIEVEMENTS.slice(0, 3).map((achievement) => achievement.name),
    ]);
  });

  it("keeps the pictures out of what a screen reader hears", async () => {
    await openProfile();

    for (const item of within(preview()).getAllByRole("listitem")) {
      expect(item.querySelector("svg").closest("[aria-hidden='true']")).not.toBeNull();
    }
  });

  it("starts a guest from Play as a guest, and the page becomes their own profile", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ getProgress: async () => PROGRESS, getMatches: async () => ({ matches: [] }) });
    const { url } = await openProfile(api);

    await user.click(screen.getByRole("button", { name: "Play as a guest" }));

    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(await screen.findByText(/You're playing as a guest/)).toBeInTheDocument();
    expect(url()).toBe("/profile");
  });

  it("offers Log in, coming back to the profile afterwards", async () => {
    await openProfile();

    expect(within(screen.getByRole("main")).getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login?next=%2Fprofile",
    );
  });
});
