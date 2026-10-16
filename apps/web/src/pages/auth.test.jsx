import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../lib/errors.js";
import { fakeApi, GUEST } from "../testing/fakes.js";
import { renderApp } from "../testing/render.jsx";

const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };

describe("LoginPage", () => {
  it("logs in and returns to where the player came from", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      login: async () => USER,
      getMatches: async () => ({ matches: [] }),
      getProgress: async () => ({}),
    });
    renderApp({ path: "/login?next=/play/chess", api });

    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Chess" })).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("Riya")).toBeInTheDocument();
  });

  it("shows the server's generic message for bad credentials", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      login: async () => {
        throw new AppRequestError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
          status: 401,
        });
      },
    });
    renderApp({ path: "/login", api });

    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });
});

describe("SignupPage", () => {
  it("validates as you go, without calling the server for invalid input", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/signup" });

    await user.type(screen.getByLabelText("Username"), "ab");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Username")).toHaveAccessibleDescription(/3–20 letters/);
    expect(api.signup).not.toHaveBeenCalled();
  });

  it("puts a server field error next to that field", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      signup: async () => {
        throw new AppRequestError({
          code: "CONFLICT",
          message: "That username is taken",
          details: { field: "username" },
        });
      },
    });
    renderApp({ path: "/signup", api });

    await user.type(screen.getByLabelText("Username"), "Riya");
    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("That username is taken")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
  });

  it("creates the account and goes home by default", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ signup: async () => USER });
    renderApp({ path: "/signup", api });

    await user.type(screen.getByLabelText("Username"), "Riya");
    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { level: 1, name: /play the classics/i })).toBeInTheDocument();
  });

  it("tells a guest their guest games won't carry over yet", async () => {
    renderApp({ path: "/signup", api: fakeApi({ getSession: async () => GUEST }) });

    expect(await screen.findByText(/guest games won't move to the new account yet/)).toBeInTheDocument();
  });
});

describe("header", () => {
  it("offers log in and sign up to visitors and guests", async () => {
    renderApp({ api: fakeApi({ getSession: async () => GUEST }) });

    const banner = screen.getByRole("banner");
    expect(await within(banner).findByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup?next=%2F",
    );
    expect(within(banner).getByRole("link", { name: "Profile" })).toBeInTheDocument();
  });

  it("offers log out to signed-in users, and logs out", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ api: fakeApi({ getSession: async () => USER }) });

    await user.click(await within(screen.getByRole("banner")).findByRole("button", { name: "Log out" }));

    expect(api.endSession).toHaveBeenCalledOnce();
    expect(
      await within(screen.getByRole("banner")).findByRole("link", { name: "Log in" }),
    ).toBeInTheDocument();
  });
});

describe("ProfilePage", () => {
  const progress = {
    xp: 60,
    level: 2,
    xpIntoLevel: 10,
    xpForNextLevel: 100,
    matchesPlayed: 3,
    wins: 2,
    losses: 1,
    draws: 0,
  };
  const match = (n, outcomeForYou) => ({
    matchId: `00000000-0000-4000-8000-00000000000${n}`,
    gameId: "rps",
    players: [
      { playerId: USER.id, displayName: "Riya" },
      { playerId: "guest_b", displayName: "Bob" },
    ],
    result: {},
    startedAt: 0,
    endedAt: Date.UTC(2026, 9, 16, 12, n),
    outcomeForYou,
  });

  it("shows level, progress bar and stats", async () => {
    renderApp({
      path: "/profile",
      api: fakeApi({
        getSession: async () => USER,
        getProgress: async () => progress,
        getMatches: async () => ({ matches: [] }),
      }),
    });

    expect(await screen.findByText("Level 2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progress to next level" })).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
    expect(screen.getByText("10 / 100 XP to level 3 · 60 XP total")).toBeInTheDocument();
    expect(await screen.findByText(/No games yet/)).toBeInTheDocument();
  });

  it("lists matches with outcomes and loads more pages", async () => {
    const user = userEvent.setup();
    const pages = [
      { matches: [match(3, "win"), match(2, "loss")], nextBefore: 123 },
      { matches: [match(1, "draw")] },
    ];
    const api = fakeApi({
      getSession: async () => USER,
      getProgress: async () => progress,
      getMatches: vi.fn(async (query) => (query.before === 123 ? pages[1] : pages[0])),
    });
    renderApp({ path: "/profile", api });

    const list = await screen.findByRole("list", { name: "Match history" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent.slice(0, 22)),
    ).toEqual(["WonRock Paper Scissors", "LostRock Paper Scissor"]);
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await within(list).findByText("Draw")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(api.getMatches).toHaveBeenLastCalledWith({ limit: 10, before: 123 });
  });

  it("invites visitors without a session to play or log in", async () => {
    renderApp({ path: "/profile" });

    expect(await screen.findByRole("link", { name: "log in" })).toHaveAttribute(
      "href",
      "/login?next=/profile",
    );
  });

  it("nudges guests to create an account", async () => {
    renderApp({
      path: "/profile",
      api: fakeApi({
        getSession: async () => GUEST,
        getProgress: async () => progress,
        getMatches: async () => ({ matches: [] }),
      }),
    });

    expect(await screen.findByRole("link", { name: "Create an account" })).toBeInTheDocument();
  });
});
