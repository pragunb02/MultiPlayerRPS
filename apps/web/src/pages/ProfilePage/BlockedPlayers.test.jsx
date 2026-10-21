import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-044: the profile lists the players you blocked, for guests and accounts, and unblocks them.
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const BOB = {
  blockId: "00000000-0000-4000-9000-000000000001",
  displayName: "Bob",
  blockedAt: Date.UTC(2026, 9, 19),
};
const CAROL = {
  blockId: "00000000-0000-4000-9000-000000000002",
  displayName: "Carol",
  blockedAt: Date.UTC(2026, 9, 18),
};

const profileApi = (overrides = {}) =>
  fakeApi({ getSession: vi.fn(async () => GUEST), getMatches: async () => ({ matches: [] }), ...overrides });

async function openBlocked(api) {
  renderApp({ path: "/profile", api });
  return screen.findByRole("region", { name: "Blocked players" });
}

describe("blocked players on the profile (CC-044)", () => {
  it("says so when a guest has blocked nobody", async () => {
    const section = await openBlocked(profileApi());

    expect(
      within(section).getByText("Blocked players are never put in a room with you. Nobody is told."),
    ).toBeVisible();
    expect(await within(section).findByText("You haven't blocked anyone.")).toBeVisible();
  });

  it("shows loading until the list arrives", async () => {
    const section = await openBlocked(profileApi({ getBlocks: vi.fn(() => new Promise(() => {})) }));

    expect(within(section).getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(within(section).getByRole("status")).toHaveTextContent("Loading your blocked players");
  });

  it("lists an account's blocks newest first, and unblocks one", async () => {
    const api = profileApi({
      getSession: vi.fn(async () => USER),
      getBlocks: vi.fn().mockResolvedValue([BOB, CAROL]),
    });
    const section = await openBlocked(api);
    const list = await within(section).findByRole("list", { name: "Blocked players" });

    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringMatching(/^Bobblocked .*Unblock/),
      expect.stringMatching(/^Carolblocked .*Unblock/),
    ]);
    expect(within(list).getAllByRole("listitem")[0].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-10-19T00:00:00.000Z",
    );

    await userEvent.click(within(list).getByRole("button", { name: "Unblock Bob" }));

    expect(api.unblockPlayer).toHaveBeenCalledWith(BOB.blockId);
    expect(await within(section).findByRole("status")).toHaveTextContent("Bob is unblocked.");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringMatching(/^Carol/)]);
  });

  it("keeps a block the server would not remove, and says why", async () => {
    const refusal = new AppRequestError({ code: "NOT_FOUND", message: "No such block", status: 404 });
    const api = profileApi({
      getBlocks: vi.fn().mockResolvedValue([BOB]),
      unblockPlayer: vi.fn().mockRejectedValue(refusal),
    });
    const section = await openBlocked(api);

    await userEvent.click(await within(section).findByRole("button", { name: "Unblock Bob" }));

    expect(await within(section).findByRole("alert")).toHaveTextContent("No such block");
    expect(within(section).getByRole("button", { name: "Unblock Bob" })).toBeVisible();
  });

  it("says when the list cannot be loaded", async () => {
    const failure = new AppRequestError({ code: "NETWORK", message: "Check your connection.", status: 0 });
    const section = await openBlocked(profileApi({ getBlocks: vi.fn().mockRejectedValue(failure) }));

    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "Couldn't load your blocked players. Check your connection.",
    );
  });

  it("forgets an answer that arrives after the page is gone", async () => {
    let answer;
    const api = profileApi({ getBlocks: vi.fn(() => new Promise((resolve) => (answer = resolve))) });
    const view = renderApp({ path: "/profile", api });
    await screen.findByRole("region", { name: "Blocked players" });

    view.unmount();
    answer([BOB]);

    await expect(Promise.resolve()).resolves.toBeUndefined();
  });
});
