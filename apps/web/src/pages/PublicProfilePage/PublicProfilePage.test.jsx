import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const HANDLE = "k3m9q2x7p4w8z1ab";
const PUBLIC = Object.freeze({
  handle: HANDLE,
  displayName: "RiyaTest",
  avatar: "crown",
  level: 7,
  stats: { gamesPlayed: 31, wins: 18 },
  chess: { rating: 1532, provisional: false, games: 14 },
});

function open(player, { identity = GUEST } = {}) {
  const api = fakeApi({
    getSession: async () => identity,
    getPlayerProfile: vi.fn(typeof player === "function" ? player : async () => player),
  });
  return renderApp({ path: `/players/${HANDLE}`, api });
}

describe("PublicProfilePage (CC-034)", () => {
  it("shows an adult's public profile: avatar, name, level, games, wins and chess rating", async () => {
    const view = open(PUBLIC);

    expect(await screen.findByRole("heading", { level: 1, name: "RiyaTest" })).toBeInTheDocument();
    expect(view.api.getPlayerProfile).toHaveBeenCalledWith(HANDLE);
    expect(screen.getByText("Level 7")).toBeInTheDocument();
    expect(screen.getByText("Played").nextSibling).toHaveTextContent("31");
    expect(screen.getByText("Won").nextSibling).toHaveTextContent("18");
    expect(screen.getByText("Chess rating").nextSibling).toHaveTextContent("1532");
    expect(document.title).toContain("RiyaTest");
  });

  it("marks a provisional rating with a question mark, and says when there is none yet", async () => {
    open({ ...PUBLIC, chess: { rating: 1500, provisional: true, games: 0 } });
    expect((await screen.findByText("Chess rating")).nextSibling).toHaveTextContent("Unrated");
  });

  it("shows a provisional rating as 1500?", async () => {
    open({ ...PUBLIC, chess: { rating: 1500, provisional: true, games: 3 } });
    expect((await screen.findByText("Chess rating")).nextSibling).toHaveTextContent("1500?");
  });

  it("shows only the name and avatar of a private profile, in Hinglish and English", async () => {
    open({ handle: HANDLE, displayName: "RiyaTest", avatar: "crown", private: true });

    expect(await screen.findByRole("heading", { level: 1, name: "RiyaTest" })).toBeInTheDocument();
    expect(screen.getByText("Yeh profile private hai.")).toHaveAttribute("lang", "hi-Latn");
    expect(screen.getByText("This profile is private.")).toHaveAttribute("lang", "en");
    expect(screen.queryByText("Played")).toBeNull();
  });

  it("shows a hidden player with the avatar they picked and no stats (owner, ADR-065)", async () => {
    open({ handle: HANDLE, hidden: true, displayName: "Hidden player", avatar: "fox" });

    expect(await screen.findByRole("heading", { level: 1, name: "Hidden player" })).toBeInTheDocument();
    expect(screen.getByText("Is player ka profile chhupa hua hai.")).toBeInTheDocument();
    expect(screen.queryByText("Played")).toBeNull();
    const header = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(header.querySelector("svg .silhouette")).toBeNull();
    expect(header.querySelector("svg path")).not.toBeNull();
  });

  it("tells a player that this is how others see their own profile", async () => {
    open({ handle: HANDLE, hidden: true, displayName: "Hidden player", own: true });

    expect(await screen.findByText("This is how other players see your profile.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your profile" })).toHaveAttribute("href", "/profile");
  });

  it("says the player was not found, the same for any refusal the server calls not found", async () => {
    open(async () => {
      throw new AppRequestError({ code: "NOT_FOUND", message: "No such player", status: 404 });
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Player not found" })).toBeInTheDocument();
    expect(screen.getByText("Yeh player nahi mila.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the leaderboards" })).toHaveAttribute(
      "href",
      "/leaderboards/overall",
    );
  });

  it("offers to try again after any other failure", async () => {
    const user = userEvent.setup();
    let calls = 0;
    open(async () => {
      calls += 1;
      if (calls === 1) throw new AppRequestError({ code: "INTERNAL", message: "Server down", status: 500 });
      return PUBLIC;
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the profile. Server down");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { level: 1, name: "RiyaTest" })).toBeInTheDocument();
  });
});

describe("reporting from a public profile (CC-044, ADR-071)", () => {
  const reportButton = () => screen.queryByRole("button", { name: "Report RiyaTest" });

  it("reports the player by the profile's handle, never an id", async () => {
    const reportPlayer = vi.fn().mockResolvedValue({ reportId: "r1", createdAt: 1 });
    const blockPlayer = vi.fn().mockResolvedValue({ blockId: "b1", displayName: "RiyaTest", blockedAt: 2 });
    renderApp({
      path: `/players/${HANDLE}`,
      api: fakeApi({
        getSession: async () => GUEST,
        getPlayerProfile: async () => PUBLIC,
        reportPlayer,
        blockPlayer,
      }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Report RiyaTest" }));
    const dialog = await screen.findByRole("dialog", { name: /Report RiyaTest/ });
    await userEvent.click(within(dialog).getByRole("radio", { name: /Offensive name/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Send report" }));

    expect(reportPlayer).toHaveBeenCalledWith({ handle: HANDLE, reason: "name" });
    const thanks = await screen.findByRole("dialog", { name: /Thanks, we got it/ });
    await userEvent.click(within(thanks).getByRole("button", { name: "Block RiyaTest too" }));
    expect(blockPlayer).toHaveBeenCalledWith({ reportId: "r1" });
    await userEvent.click(within(thanks).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no Report on your own profile, a hidden one, or to a visitor", async () => {
    const own = open({ ...PUBLIC, own: true });
    await screen.findByRole("heading", { level: 1, name: "RiyaTest" });
    expect(reportButton()).toBeNull();
    own.unmount();

    const hidden = open({ handle: HANDLE, hidden: true, displayName: "Hidden player" });
    await screen.findByRole("heading", { level: 1, name: "Hidden player" });
    expect(screen.queryByRole("button", { name: /^Report/ })).toBeNull();
    hidden.unmount();

    renderApp({
      path: `/players/${HANDLE}`,
      api: fakeApi({ getSession: async () => undefined, getPlayerProfile: async () => PUBLIC }),
    });
    await screen.findByRole("heading", { level: 1, name: "RiyaTest" });
    expect(reportButton()).toBeNull();
  });
});
