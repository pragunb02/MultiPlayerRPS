import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_MESSAGES } from "@classicade/shared";
import { AppRequestError } from "../lib/errors.js";
import { fakeApi, GUEST, PROGRESS } from "../testing/fakes.js";
import { renderApp } from "../testing/render.jsx";

const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };

describe("LoginPage", () => {
  it("logs in and returns to where the player came from", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      login: async () => ({ identity: USER }),
      getMatches: async () => ({ matches: [] }),
      getProgress: async () => PROGRESS,
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

  it.each([
    ["no field", new AppRequestError({ code: "NETWORK", message: "Can't reach ClassiCade" })],
    [
      "a field the form doesn't have",
      new AppRequestError({
        code: "VALIDATION_FAILED",
        message: "Unknown fields in payload",
        details: { field: "age" },
      }),
    ],
  ])("shows a server error about %s above the button, with every field valid", async (_case, error) => {
    const user = userEvent.setup();
    renderApp({ path: "/signup", api: fakeApi({ signup: async () => Promise.reject(error) }) });

    await user.type(screen.getByLabelText("Username"), "Riya");
    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(error.message);
    for (const label of ["Username", "Email", "Password"]) {
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-invalid", "true");
    }
  });

  // CC-238: one message for every email that cannot be used, and a way on for the person it belongs to.
  describe("an email that can't be used", () => {
    const unavailable = () =>
      new AppRequestError({
        code: "CONFLICT",
        message: ACCOUNT_MESSAGES.EMAIL_UNAVAILABLE,
        details: { field: "email" },
        status: 409,
      });

    async function signUpWithTakenEmail(path) {
      const user = userEvent.setup();
      const api = fakeApi({ signup: async () => Promise.reject(unavailable()) });
      renderApp({ path, api });
      await user.type(screen.getByLabelText("Username"), "Riya");
      await user.type(screen.getByLabelText("Email"), "riya@example.com");
      await user.type(screen.getByLabelText("Password"), "correct horse battery");
      await user.click(screen.getByRole("button", { name: "Create account" }));
      return user;
    }

    it("says the one message at the email field, with log in as a link that keeps next", async () => {
      await signUpWithTakenEmail("/signup?next=%2Fgames%2Fchess");

      const email = screen.getByLabelText("Email");
      await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
      expect(email).toHaveAccessibleDescription(ACCOUNT_MESSAGES.EMAIL_UNAVAILABLE);
      const logIn = within(screen.getByText(/If it's yours/)).getByRole("link", { name: "log in" });
      expect(logIn).toHaveAttribute("href", "/login?next=%2Fgames%2Fchess");
      expect(logIn.getAttribute("href")).not.toContain("riya");
    });

    it("links nothing for resetting the password, which does not exist yet (CC-033)", async () => {
      await signUpWithTakenEmail("/signup");

      const message = await screen.findByText(/If it's yours/);
      expect(within(message).getAllByRole("link")).toHaveLength(1);
      expect(within(message).getByRole("link")).toHaveAttribute("href", "/login");
    });

    it("takes the player to the login page from the link", async () => {
      const user = await signUpWithTakenEmail("/signup");

      await user.click(await screen.findByRole("link", { name: "log in", exact: true }));

      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
      expect(screen.getByLabelText("Email")).toHaveValue("");
    });
  });

  it("sends one sign-up for a double click", async () => {
    const user = userEvent.setup();
    let answer;
    const api = fakeApi({ signup: vi.fn(() => new Promise((resolve) => (answer = resolve))) });
    renderApp({ path: "/signup", api });
    await user.type(screen.getByLabelText("Username"), "Riya");
    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");

    await user.dblClick(screen.getByRole("button", { name: "Create account" }));
    answer({ identity: USER });

    expect(await screen.findByRole("heading", { level: 1, name: /play the classics/i })).toBeInTheDocument();
    expect(api.signup).toHaveBeenCalledOnce();
  });

  it("creates the account and goes home by default", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ signup: async () => ({ identity: USER }) });
    renderApp({ path: "/signup", api });

    await user.type(screen.getByLabelText("Username"), "Riya");
    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { level: 1, name: /play the classics/i })).toBeInTheDocument();
  });

  it("tells a guest their progress comes along (CC-032)", async () => {
    renderApp({ path: "/signup", api: fakeApi({ getSession: async () => GUEST }) });

    expect(
      await screen.findByText("Your guest XP, level and match history will move to your new account."),
    ).toBeInTheDocument();
  });

  it("says nothing about guest progress to a visitor without a session", async () => {
    renderApp({ path: "/signup" });
    await screen.findByRole("heading", { name: "Create your account" });

    expect(screen.queryByText(/guest XP/)).toBeNull();
  });
});

describe("a guest's progress moving to the account (CC-032, CC-097)", () => {
  const CARRIED = { xp: 70, matchesPlayed: 3, matches: 3 };
  // The account right after signing in: its own totals, the guest's included.
  const ACCOUNT = { ...PROGRESS, xp: 370, level: 4, xpIntoLevel: 70, xpForNextLevel: 200, matchesPlayed: 13 };
  const SAVED = "Your progress is now saved: Level 4 · 370 XP · 13 matches";

  async function fillSignup(user) {
    await user.type(screen.getByLabelText("Username"), "Riya");
    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));
  }

  async function fillLogin(user) {
    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));
  }

  it("tells a guest on the login page that their games are added to the account", async () => {
    renderApp({ path: "/login", api: fakeApi({ getSession: async () => GUEST }) });

    expect(
      await screen.findByText("Logging in adds this guest's XP and matches to your account."),
    ).toBeInTheDocument();
  });

  it.each([
    ["signup", "/signup", fillSignup],
    ["login", "/login", fillLogin],
  ])(
    "confirms once, with the account's numbers, after a guest's %s brought games along",
    async (method, path, fill) => {
      const user = userEvent.setup();
      const getProgress = vi.fn().mockResolvedValue(PROGRESS);
      renderApp({
        path,
        api: fakeApi({
          getSession: async () => GUEST,
          getProgress,
          [method]: async () => {
            getProgress.mockResolvedValue(ACCOUNT);
            return { identity: USER, carriedOver: CARRIED };
          },
        }),
      });
      await screen.findByText(/new account|adds this guest's XP/);

      await fill(user);

      expect(await screen.findByText(SAVED)).toBeInTheDocument();
      expect(
        await screen.findByRole("heading", { level: 1, name: /play the classics/i }),
      ).toBeInTheDocument();
      expect(screen.getAllByText(/now saved/)).toHaveLength(1);
    },
  );

  it("says '1 match' for a single match", async () => {
    const user = userEvent.setup();
    renderApp({
      path: "/signup",
      api: fakeApi({
        getSession: async () => GUEST,
        getProgress: vi.fn().mockResolvedValue({ ...PROGRESS, xp: 30, matchesPlayed: 1 }),
        signup: async () => ({ identity: USER, carriedOver: { xp: 30, matchesPlayed: 1, matches: 1 } }),
      }),
    });
    await screen.findByText(/will move to your new account/);

    await fillSignup(user);

    expect(
      await screen.findByText("Your progress is now saved: Level 1 · 30 XP · 1 match"),
    ).toBeInTheDocument();
  });

  it("still confirms, without numbers, when the account's progress can't be read", async () => {
    const user = userEvent.setup();
    const getProgress = vi.fn().mockResolvedValue(PROGRESS);
    renderApp({
      path: "/signup",
      api: fakeApi({
        getSession: async () => GUEST,
        getProgress,
        signup: async () => {
          getProgress.mockRejectedValue(new AppRequestError({ code: "NETWORK", message: "offline" }));
          return { identity: USER, carriedOver: CARRIED };
        },
      }),
    });
    await screen.findByText(/will move to your new account/);

    await fillSignup(user);

    expect(await screen.findByText("Your progress is now saved.")).toBeInTheDocument();
  });

  it.each([
    ["signup", "/signup", fillSignup, { xp: 0, matchesPlayed: 0, matches: 0 }],
    ["login", "/login", fillLogin, { xp: 0, matchesPlayed: 0, matches: 0 }],
    ["signup", "/signup", fillSignup, undefined],
  ])("stays quiet after %s when no guest games moved (%o)", async (method, path, fill, carriedOver) => {
    const user = userEvent.setup();
    const api = fakeApi({
      getSession: async () => GUEST,
      [method]: async () => ({ identity: USER, ...(carriedOver && { carriedOver }) }),
    });
    renderApp({ path, api });
    await screen.findByText(/new account|adds this guest's XP/);
    api.getProgress.mockClear();

    await fill(user);

    expect(await screen.findByRole("heading", { level: 1, name: /play the classics/i })).toBeInTheDocument();
    expect(screen.queryByText(/now saved/)).toBeNull();
  });

  it("confirms for a guest whose only progress is XP (no match counted yet)", async () => {
    const user = userEvent.setup();
    renderApp({
      path: "/login",
      api: fakeApi({
        getSession: async () => GUEST,
        getProgress: vi.fn().mockResolvedValue({ ...PROGRESS, xp: 20 }),
        login: async () => ({ identity: USER, carriedOver: { xp: 20, matchesPlayed: 0, matches: 0 } }),
      }),
    });
    await screen.findByText(/adds this guest's XP/);

    await fillLogin(user);

    expect(
      await screen.findByText("Your progress is now saved: Level 1 · 20 XP · 0 matches"),
    ).toBeInTheDocument();
  });
});

describe("header", () => {
  it("offers log in and sign up to visitors and guests", async () => {
    renderApp({ api: fakeApi({ getSession: async () => GUEST }) });

    const banner = screen.getByRole("banner");
    expect(await within(banner).findByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
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

  it("logging out from any page lands on home", async () => {
    const user = userEvent.setup();
    const { url } = renderApp({
      path: "/profile",
      api: fakeApi({
        getSession: async () => USER,
        getProgress: async () => PROGRESS,
        getMatches: async () => ({ matches: [] }),
      }),
    });

    await user.click(await within(screen.getByRole("banner")).findByRole("button", { name: "Log out" }));

    await within(screen.getByRole("banner")).findByRole("link", { name: "Log in" });
    // The header shows "Log in" as soon as the session ends; the navigation home follows it.
    await waitFor(() => expect(url()).toBe("/"));
  });

  it("keeps the player signed in and says why when logging out fails", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      getSession: async () => USER,
      endSession: async () => {
        throw new AppRequestError({ code: "NETWORK", message: "Can't reach ClassiCade" });
      },
    });
    const { url } = renderApp({ path: "/games/chess", api });

    await user.click(await within(screen.getByRole("banner")).findByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach ClassiCade");
    expect(within(screen.getByRole("banner")).getByText("Riya")).toBeInTheDocument();
    expect(url()).toBe("/games/chess");
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
    expect(screen.getByText("Rookie rank")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progress to next level" })).toHaveAttribute(
      "value",
      "10",
    );
    expect(screen.getByText("10 / 100 XP to level 3 · 60 XP total")).toBeInTheDocument();
    expect(await screen.findByText(/No games yet/)).toBeInTheDocument();
    expect(screen.getByText(/No games yet/).previousElementSibling).toHaveAttribute("aria-hidden", "true");
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

  it("labels a computer opponent in the history as a computer, never as a person of that name", async () => {
    const vsRocky = {
      ...match(4, "win"),
      players: [
        { playerId: USER.id, displayName: "Riya" },
        { playerId: "bot_rocky_easy", displayName: "Rocky", computer: true },
      ],
    };
    const vsPerson = {
      ...match(3, "loss"),
      players: [
        { playerId: USER.id, displayName: "Riya" },
        { playerId: "user_rocky", displayName: "Rocky" },
      ],
    };
    renderApp({
      path: "/profile",
      api: fakeApi({
        getSession: async () => USER,
        getProgress: async () => progress,
        getMatches: async () => ({ matches: [vsRocky, vsPerson] }),
      }),
    });

    const list = await screen.findByRole("list", { name: "Match history" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("Rock Paper Scissors vs Rocky (computer)");
    expect(second).toHaveTextContent("Rock Paper Scissors vs Rocky");
    expect(second).not.toHaveTextContent("computer");
  });

  it("says so when the next page of matches can't be loaded, keeping the list and the button", async () => {
    const user = userEvent.setup();
    const api = fakeApi({
      getSession: async () => USER,
      getProgress: async () => progress,
      getMatches: vi.fn(async (query) => {
        if (query.before === undefined) return { matches: [match(3, "win")], nextBefore: 123 };
        throw new AppRequestError({ code: "NETWORK", message: "Can't reach ClassiCade" });
      }),
    });
    renderApp({ path: "/profile", api });
    const list = await screen.findByRole("list", { name: "Match history" });

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load more matches. Can't reach ClassiCade",
    );
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });

  it.each([
    [
      "progress",
      {
        getProgress: async () => Promise.reject(new Error("boom")),
        getMatches: async () => ({ matches: [] }),
      },
      "Couldn't load progress. boom",
    ],
    [
      "matches",
      { getProgress: async () => progress, getMatches: async () => Promise.reject(new Error("down")) },
      "Couldn't load matches. down",
    ],
  ])("explains when %s can't be loaded", async (_what, overrides, text) => {
    renderApp({ path: "/profile", api: fakeApi({ getSession: async () => USER, ...overrides }) });

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("shows a full bar at the highest level, where there is no next level", async () => {
    renderApp({
      path: "/profile",
      api: fakeApi({
        getSession: async () => USER,
        getProgress: async () => ({ ...progress, level: 50, xpIntoLevel: 0, xpForNextLevel: 0 }),
        getMatches: async () => ({ matches: [] }),
      }),
    });

    const bar = await screen.findByRole("progressbar", { name: "Progress to next level" });
    expect(bar).toHaveAttribute("max", "1");
    expect(bar).toHaveAttribute("value", "1");
  });

  it("names unknown games by id and shows '—' when there was no opponent", async () => {
    const solo = {
      ...match(1, "win"),
      gameId: "ludo",
      players: [{ playerId: USER.id, displayName: "Riya" }],
    };
    renderApp({
      path: "/profile",
      api: fakeApi({
        getSession: async () => USER,
        getProgress: async () => progress,
        getMatches: async () => ({ matches: [solo] }),
      }),
    });

    expect(await screen.findByText("ludo vs —")).toBeInTheDocument();
  });

  it("invites visitors without a session to play or log in", async () => {
    renderApp({ path: "/profile" });

    expect(await screen.findByRole("link", { name: "log in" })).toHaveAttribute(
      "href",
      "/login?next=%2Fprofile",
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
