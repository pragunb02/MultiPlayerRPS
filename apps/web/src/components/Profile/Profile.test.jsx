import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AVATARS } from "@classicade/shared";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST, OWN_PROFILE } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { PROFILE_COPY } from "./profileCopy.js";

const USER = Object.freeze({ kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "RiyaTest" });

const openProfile = ({ identity = GUEST, ...overrides } = {}) =>
  renderApp({ path: "/profile", api: fakeApi({ getSession: async () => identity, ...overrides }) });

describe("profile copy (CC-034)", () => {
  it("has a Hinglish line and an English line for every message", () => {
    for (const [name, copy] of Object.entries(PROFILE_COPY)) {
      expect(copy.hi.length, name).toBeGreaterThan(0);
      expect(copy.en.length, name).toBeGreaterThan(0);
    }
  });

  it('speaks to the player with "tum", never "aap" (owner, 2026-10-20)', () => {
    const hinglish = Object.values(PROFILE_COPY).map((copy) => copy.hi.toLowerCase());

    expect(hinglish.some((line) => /\btum(hara|hare|hari)?\b/.test(line))).toBe(true);
    expect(hinglish.filter((line) => /\baap(ka|ke|ki)?\b/.test(line))).toEqual([]);
  });
});

describe("the avatar picker on your profile (CC-034)", () => {
  it("offers every avatar of the catalogue as a radio button, by name", async () => {
    openProfile();

    const picker = await screen.findByRole("group", { name: "Your avatar" });

    expect(
      within(picker)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label").textContent),
    ).toEqual(AVATARS.map((avatar) => avatar.name));
    expect(within(picker).getByText(PROFILE_COPY.guestAvatar.hi)).toBeInTheDocument();
  });

  it("saves the avatar picked, says so, and shows it beside your name", async () => {
    const user = userEvent.setup();
    const view = openProfile();
    const picker = await screen.findByRole("group", { name: "Your avatar" });

    await user.click(within(picker).getByRole("radio", { name: "Owl" }));

    expect(view.api.setAvatar).toHaveBeenCalledWith("owl");
    expect(await within(picker).findByRole("status")).toHaveTextContent("Owl is your avatar now.");
    expect(within(picker).getByRole("radio", { name: "Owl" })).toBeChecked();
    const heading = screen.getByRole("heading", { level: 1, name: GUEST.displayName });
    expect(heading.parentElement.querySelector("svg .silhouette")).toBeNull();
  });

  it("says when the avatar could not be saved", async () => {
    const user = userEvent.setup();
    openProfile({
      setAvatar: vi.fn(async () => {
        throw new AppRequestError({ code: "RATE_LIMITED", message: "Too many changes", status: 429 });
      }),
    });
    const picker = await screen.findByRole("group", { name: "Your avatar" });

    await user.click(within(picker).getByRole("radio", { name: "Fox" }));

    expect(await within(picker).findByRole("alert")).toHaveTextContent(
      "Couldn't save your avatar. Too many changes",
    );
  });

  it("says when your profile settings could not be loaded", async () => {
    openProfile({
      getOwnProfile: vi.fn(async () => {
        throw new AppRequestError({ code: "INTERNAL", message: "Server down", status: 500 });
      }),
    });

    expect(await screen.findByText("Couldn't load your profile settings. Server down")).toBeInTheDocument();
  });
});

describe("who sees your profile (CC-034)", () => {
  it("lets an adult make their profile public and private again", async () => {
    const user = userEvent.setup();
    let visibility = "private";
    const view = openProfile({
      identity: USER,
      getOwnProfile: vi.fn(async () => ({ ...OWN_PROFILE, canBePublic: true })),
      setProfileVisibility: vi.fn(async (next) => {
        visibility = next;
        return { ...OWN_PROFILE, canBePublic: true, visibility };
      }),
    });

    await user.click(await screen.findByRole("button", { name: "Make my profile public" }));
    expect(view.api.setProfileVisibility).toHaveBeenCalledWith("public");
    expect(await screen.findByText(PROFILE_COPY.publicNow.hi)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Make my profile private" }));
    expect(view.api.setProfileVisibility).toHaveBeenLastCalledWith("private");
    expect(await screen.findByText(PROFILE_COPY.privateNow.hi)).toBeInTheDocument();
  });

  it("keeps it hidden for anyone not surely an adult, says why, and sends nothing", async () => {
    const user = userEvent.setup();
    const view = openProfile();

    const button = await screen.findByRole("button", { name: /Make my profile public/ });
    await user.click(button);

    expect(screen.getByText(PROFILE_COPY.locked.hi)).toBeInTheDocument();
    expect(view.api.setProfileVisibility).not.toHaveBeenCalled();
  });

  it("links to your own public profile", async () => {
    openProfile();

    expect(await screen.findByRole("link", { name: `/players/${OWN_PROFILE.handle}` })).toHaveAttribute(
      "href",
      `/players/${OWN_PROFILE.handle}`,
    );
  });
});

describe("past opponents in your history (CC-034)", () => {
  it("links an opponent the server linked, and shows everyone else's name only", async () => {
    openProfile({
      getMatches: vi.fn(async () => ({
        matches: [
          {
            matchId: "00000000-0000-4000-8000-000000000001",
            gameId: "chess",
            you: "you-id",
            players: [
              { playerId: "you-id", displayName: GUEST.displayName },
              { playerId: "adult", displayName: "RiyaTest", avatar: "crown", profile: "k3m9q2x7p4w8z1ab" },
            ],
            outcomeForYou: "loss",
            endedAt: Date.UTC(2026, 9, 20),
          },
          {
            matchId: "00000000-0000-4000-8000-000000000002",
            gameId: "rps",
            you: "you-id",
            players: [
              { playerId: "you-id", displayName: GUEST.displayName },
              { playerId: "minor", displayName: "KabirTest", avatar: "fox" },
              { playerId: "bot", displayName: "Rocky", computer: true },
            ],
            outcomeForYou: "win",
            endedAt: Date.UTC(2026, 9, 19),
          },
        ],
      })),
    });

    const history = await screen.findByRole("list", { name: "Match history" });
    const [first, second] = within(history).getAllByRole("listitem");

    expect(within(first).getByRole("link", { name: "RiyaTest" })).toHaveAttribute(
      "href",
      "/players/k3m9q2x7p4w8z1ab",
    );
    expect(within(second).queryByRole("link")).toBeNull();
    expect(second).toHaveTextContent("Rock Paper Scissors vs KabirTest, Rocky (computer)");
  });
});

describe("reporting a past opponent from your history (CC-044, ADR-071)", () => {
  const match = {
    matchId: "00000000-0000-4000-8000-000000000003",
    gameId: "rps",
    you: "you-id",
    players: [
      { playerId: "bot", displayName: "Rocky", computer: true },
      { playerId: "you-id", displayName: GUEST.displayName },
      { playerId: "other-id", displayName: "KabirTest", avatar: "fox" },
      { playerId: "gone-id", displayName: "Deleted player" },
    ],
    outcomeForYou: "win",
    endedAt: Date.UTC(2026, 9, 19),
  };

  it("offers Report for each person you played, never a computer or a deleted player, and sends the match and place", async () => {
    const reportPlayer = vi.fn().mockResolvedValue({ reportId: "r1", createdAt: 1 });
    const blockPlayer = vi.fn().mockResolvedValue({ blockId: "b1", displayName: "KabirTest", blockedAt: 2 });
    openProfile({ getMatches: vi.fn(async () => ({ matches: [match] })), reportPlayer, blockPlayer });
    const history = await screen.findByRole("list", { name: "Match history" });

    expect(
      within(history)
        .getAllByRole("button", { name: /^Report / })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Report KabirTest"]);
    await userEvent.click(within(history).getByRole("button", { name: "Report KabirTest" }));
    const dialog = await screen.findByRole("dialog", { name: /Report KabirTest/ });
    await userEvent.click(within(dialog).getByRole("radio", { name: /Cheating or stalling/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Send report" }));

    expect(reportPlayer).toHaveBeenCalledWith({ matchId: match.matchId, seat: 2, reason: "cheating" });
    const thanks = await screen.findByRole("dialog", { name: /Thanks, we got it/ });
    await userEvent.click(within(thanks).getByRole("button", { name: "Block KabirTest too" }));
    expect(blockPlayer).toHaveBeenCalledWith({ reportId: "r1" });
    await userEvent.click(within(thanks).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
