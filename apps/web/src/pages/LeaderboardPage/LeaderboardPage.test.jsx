import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const USER = Object.freeze({ kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "riya" });
const NOW = Date.parse("2026-10-16T12:00:00Z");

const boardInfo = (id, overrides = {}) => ({
  id,
  name: "Overall XP",
  metric: "xp",
  period: "all",
  periodId: "all",
  ...overrides,
});
const entry = (rank, displayName, score, level = 3) => ({ rank, displayName, level, score });
const ENTRIES = [entry(1, "ada", 900, 6), entry(2, "bob", 500), entry(3, "cy", 300), entry(4, "dee", 100)];

/** A fake API whose boards answer from `boards` (by id); unknown ids get an empty board. */
function api({ identity, boards = {} } = {}) {
  return fakeApi({
    getSession: async () => identity,
    getLeaderboard: vi.fn(async (id) => boards[id] ?? { board: boardInfo(id), entries: [] }),
  });
}

const rows = () => within(screen.getByRole("list", { name: /rankings/ })).getAllByRole("listitem");

afterEach(() => {
  vi.useRealTimers();
});

describe("LeaderboardPage", () => {
  it("lists the top players with medals for the first three, and names the board", async () => {
    renderApp({
      path: "/leaderboards/overall",
      api: api({ boards: { overall: { board: boardInfo("overall"), entries: ENTRIES } } }),
    });

    expect(await screen.findByRole("list", { name: "Overall XP rankings" })).toBeInTheDocument();
    expect(rows().map((row) => row.textContent)).toEqual([
      "1adaLv 6900 XP",
      "2bobLv 3500 XP",
      "3cyLv 3300 XP",
      "4deeLv 3100 XP",
    ]);
    expect(rows()[0]).toHaveClass("gold");
    expect(rows()[1]).toHaveClass("silver");
    expect(rows()[2]).toHaveClass("bronze");
    expect(rows()[3]).not.toHaveClass("gold", "silver", "bronze");
    // Arcade art (CC-087): medals behind the podium places, a tier shield beside each level; the text is unchanged.
    expect(
      rows().map((row) => row.querySelector(".rank svg")?.querySelector("circle").getAttribute("class")),
    ).toEqual(["gold", "silver", "bronze", undefined]);
    expect(rows()[0].querySelector(".level svg")).toHaveAttribute("aria-hidden", "true");
    expect(rows()[0].querySelector(".level")).toHaveAttribute("title", "Challenger rank");
    expect(rows()[1].querySelector(".level")).toHaveAttribute("title", "Rookie rank");
    expect(document.title).toBe("Overall XP · Leaderboards · ClassiCade");
    expect(screen.getByRole("heading", { level: 2, name: "Overall XP" })).toBeInTheDocument();
  });

  it("counts wins on a game's board", async () => {
    const chess = {
      board: boardInfo("chess", { name: "Chess", metric: "wins" }),
      entries: [entry(1, "ada", 1), entry(2, "bob", 7)],
    };
    renderApp({ path: "/leaderboards/chess", api: api({ boards: { chess } }) });

    expect(await screen.findByRole("heading", { level: 2, name: "Chess wins" })).toBeInTheDocument();
    expect(await screen.findByText("1 win")).toBeInTheDocument();
    expect(screen.getByText("7 wins")).toBeInTheDocument();
  });

  it("heads the rankings with what each column holds, in the board's unit (CC-323)", async () => {
    renderApp({
      path: "/leaderboards/overall",
      api: api({ boards: { overall: { board: boardInfo("overall"), entries: ENTRIES } } }),
    });

    await screen.findByRole("list", { name: "Overall XP rankings" });
    const head = document.querySelector(".head");
    expect(head).toHaveAttribute("aria-hidden", "true");
    expect([...head.children].map((cell) => cell.textContent)).toEqual(["Place", "Player", "Level", "XP"]);
  });

  it("reserves the board's room with row shapes while it loads, as one busy status (CC-323)", () => {
    renderApp({ path: "/leaderboards/chess", api: api() });

    const status = screen.getByRole("status", { busy: true });
    expect(status).toHaveTextContent("Loading the leaderboard…");
    expect(status.querySelectorAll(".row")).toHaveLength(6);
  });

  it("invites the first winner when nobody is ranked yet", async () => {
    renderApp({ path: "/leaderboards/tic-tac-toe", api: api() });

    expect(
      await screen.findByRole("heading", { level: 3, name: "No ranked players yet." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Win a match to claim #1!")).toBeInTheDocument();
  });

  it("explains a failure and tries again", async () => {
    const user = userEvent.setup();
    const fake = api();
    fake.getLeaderboard
      .mockRejectedValueOnce(new AppRequestError({ code: "NETWORK", message: "You're offline." }))
      .mockResolvedValueOnce({ board: boardInfo("overall"), entries: ENTRIES });
    renderApp({ path: "/leaderboards/overall", api: fake });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Couldn.t load the leaderboard\.You.re offline\./,
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("list", { name: "Overall XP rankings" })).toBeInTheDocument();
  });

  it("shows loading until the board arrives, and waits for the session first", async () => {
    let answer;
    const fake = api({ identity: USER });
    fake.getLeaderboard.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    renderApp({ path: "/leaderboards/overall", api: fake });

    expect(await screen.findByText("Loading the leaderboard…")).toBeInTheDocument();
    await waitFor(() => expect(fake.getLeaderboard).toHaveBeenCalledOnce());
    await act(async () => answer({ board: boardInfo("overall"), entries: ENTRIES }));

    expect(await screen.findByRole("list", { name: "Overall XP rankings" })).toBeInTheDocument();
  });

  it("counts down to the weekly reset", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] });
    const weekly = {
      board: boardInfo("weekly", {
        name: "This week",
        period: "week",
        periodId: "2026-W42",
        resetsAt: Date.parse("2026-10-18T16:30:00Z"),
      }),
      entries: ENTRIES,
    };
    renderApp({ path: "/leaderboards/weekly", api: api({ boards: { weekly } }) });

    expect(await screen.findByText("Resets in 2d 4h")).toBeInTheDocument();
    expect(screen.getByText(/Everyone starts again on Monday/)).toBeInTheDocument();
    // The countdown's clock starts in an effect, which can run a moment after the text shows. It is the page's only
    // timer. Vitest's own wait runs on real time, so the fake clock does not stop it (CC-288).
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    act(() => vi.advanceTimersByTime(4 * 60 * 60 * 1000 + 60_000));
    expect(screen.getByText("Resets in 2d 0h")).toBeInTheDocument();
  });

  describe("your rank", () => {
    it("highlights you in the list", async () => {
      const overall = {
        board: boardInfo("overall"),
        entries: ENTRIES,
        you: { listed: true, rank: 2, score: 500 },
      };
      renderApp({ path: "/leaderboards/overall", api: api({ identity: USER, boards: { overall } }) });

      await screen.findByRole("list", { name: "Overall XP rankings" });

      expect(rows()[1]).toHaveAttribute("aria-current", "true");
      expect(within(rows()[1]).getByText("you")).toBeInTheDocument();
      expect(screen.queryByText("Your rank:")).not.toBeInTheDocument();
    });

    it("pins your row below the list when you are outside it", async () => {
      const overall = {
        board: boardInfo("overall"),
        entries: ENTRIES,
        you: { listed: true, rank: 73, score: 40 },
      };
      renderApp({ path: "/leaderboards/overall", api: api({ identity: USER, boards: { overall } }) });

      expect(await screen.findByText("#73")).toBeInTheDocument();
      expect(screen.getByText("Your rank:").parentElement).toHaveTextContent("Your rank: #73You40 XP");
    });

    it("tells an account without a score how to get ranked", async () => {
      const chess = {
        board: boardInfo("chess"),
        entries: ENTRIES,
        you: { listed: false, reason: "unranked" },
      };
      renderApp({ path: "/leaderboards/chess", api: api({ identity: USER, boards: { chess } }) });

      expect(
        await screen.findByText("You're not on this board yet. Win a match to get ranked."),
      ).toBeInTheDocument();
    });

    it("marks a guest's own row, under its Guest name, and invites it to keep its place (ADR-060)", async () => {
      const overall = {
        board: boardInfo("overall"),
        entries: [entry(1, "ada", 900, 6), entry(2, "Guest-T7K2", 500)],
        you: { listed: true, rank: 2, score: 500 },
      };
      renderApp({ path: "/leaderboards/overall", api: api({ identity: GUEST, boards: { overall } }) });

      await screen.findByRole("list", { name: "Overall XP rankings" });

      expect(rows()[1]).toHaveAttribute("aria-current", "true");
      expect(rows()[1]).toHaveTextContent("2Guest-T7K2youLv 3500 XP");
      const nudge = screen.getByText(/to keep your place on the boards/);
      expect(nudge).toHaveTextContent("Sign up to keep your place on the boards.");
      expect(within(nudge).getByRole("link", { name: "Sign up" })).toHaveAttribute(
        "href",
        "/signup?next=%2Fleaderboards%2Foverall",
      );
    });

    it("pins a guest's row below the list as You when it is outside it (ADR-060)", async () => {
      const overall = {
        board: boardInfo("overall"),
        entries: ENTRIES,
        you: { listed: true, rank: 51, score: 30 },
      };
      renderApp({ path: "/leaderboards/overall", api: api({ identity: GUEST, boards: { overall } }) });

      expect(await screen.findByText("#51")).toBeInTheDocument();
      expect(screen.getByText("Your rank:").parentElement).toHaveTextContent("Your rank: #51You30 XP");
    });

    it("tells a guest without a score how to get ranked, and how to keep it (ADR-060)", async () => {
      const chess = {
        board: boardInfo("chess"),
        entries: ENTRIES,
        you: { listed: false, reason: "unranked" },
      };
      renderApp({ path: "/leaderboards/chess", api: api({ identity: GUEST, boards: { chess } }) });

      expect(
        await screen.findByText("You're not on this board yet. Win a match to get ranked."),
      ).toBeInTheDocument();
      expect(screen.getByText(/to keep your place on the boards/)).toBeInTheDocument();
    });

    it("never asks an account to sign up", async () => {
      const overall = {
        board: boardInfo("overall"),
        entries: ENTRIES,
        you: { listed: true, rank: 2, score: 500 },
      };
      renderApp({ path: "/leaderboards/overall", api: api({ identity: USER, boards: { overall } }) });

      await screen.findByRole("list", { name: "Overall XP rankings" });

      expect(screen.queryByText(/keep your place/)).not.toBeInTheDocument();
    });

    it("shows a visitor without a session no row of their own", async () => {
      renderApp({
        path: "/leaderboards/overall",
        api: api({ boards: { overall: { board: boardInfo("overall"), entries: ENTRIES } } }),
      });

      await screen.findByRole("list", { name: "Overall XP rankings" });

      expect(screen.queryByText(/Your rank|keep your place|not on this board/)).not.toBeInTheDocument();
    });
  });

  describe("tabs and URLs", () => {
    it("has one link per board and marks the current one", async () => {
      renderApp({ path: "/leaderboards/weekly", api: api() });

      const tabs = within(await screen.findByRole("navigation", { name: "Leaderboards" })).getAllByRole(
        "link",
      );

      expect(tabs.map((tab) => [tab.textContent, tab.getAttribute("href")])).toEqual([
        ["Overall XP", "/leaderboards/overall"],
        ["This week", "/leaderboards/weekly"],
        ["Rock Paper Scissors", "/leaderboards/rock-paper-scissors"],
        ["Tic Tac Toe", "/leaderboards/tic-tac-toe"],
        ["Chess", "/leaderboards/chess"],
      ]);
      expect(tabs[1]).toHaveAttribute("aria-current", "page");
      // Each tab is pictured: medals for the XP boards, the game's glyph for a game's board.
      expect(tabs.map((tab) => tab.querySelector("svg").getAttribute("aria-hidden"))).toEqual(
        Array(5).fill("true"),
      );
      expect(tabs[2].querySelector("svg")).toHaveClass("rps");
      expect(tabs[0].querySelector("svg circle")).toHaveClass("gold");
    });

    it("switches boards by link, and Back and Forward return to each one", async () => {
      const user = userEvent.setup();
      const fake = api({
        boards: {
          overall: { board: boardInfo("overall"), entries: ENTRIES },
          chess: {
            board: boardInfo("chess", { name: "Chess", metric: "wins" }),
            entries: [entry(1, "zed", 4)],
          },
        },
      });
      const view = renderApp({ path: "/leaderboards/overall", api: fake });
      await screen.findByRole("list", { name: "Overall XP rankings" });

      await user.click(screen.getByRole("link", { name: "Chess" }));
      expect(await screen.findByRole("list", { name: "Chess rankings" })).toHaveTextContent("zed");
      expect(view.url()).toBe("/leaderboards/chess");

      view.back();
      expect(await screen.findByRole("list", { name: "Overall XP rankings" })).toHaveTextContent("ada");
      expect(view.url()).toBe("/leaderboards/overall");

      view.forward();
      expect(await screen.findByRole("list", { name: "Chess rankings" })).toBeInTheDocument();
      expect(fake.getLeaderboard.mock.calls.map(([id]) => id)).toEqual([
        "overall",
        "chess",
        "overall",
        "chess",
      ]);
    });

    it("sends /leaderboards to the overall board, replacing the entry", async () => {
      const view = renderApp({ path: "/leaderboards", history: ["/"], api: api() });

      await waitFor(() => expect(view.url()).toBe("/leaderboards/overall"));
      view.back();
      await waitFor(() => expect(view.url()).toBe("/"));
    });

    it("does not know other boards", async () => {
      const fake = api();
      const view = renderApp({ path: "/leaderboards/ludo", api: fake });

      expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
      expect(view.url()).toBe("/leaderboards/ludo");
      expect(fake.getLeaderboard).not.toHaveBeenCalled();
    });

    it("is linked from the header, for everyone", async () => {
      renderApp({ path: "/", api: api() });

      const nav = screen.getByRole("navigation", { name: "Main" });
      expect(within(nav).getByRole("link", { name: "Leaderboards" })).toHaveAttribute(
        "href",
        "/leaderboards/overall",
      );
    });
  });

  describe("how to get on the board, beside a board with few players (CC-259)", () => {
    const howTo = () => screen.findByRole("complementary", { name: "How to get on the board" });
    const manyEntries = Array.from({ length: 25 }, (_, index) =>
      entry(index + 1, `p${index + 1}`, 1000 - index),
    );

    it("explains the rules of the XP board, with one button to the games", async () => {
      renderApp({
        path: "/leaderboards/overall",
        api: api({ boards: { overall: { board: boardInfo("overall"), entries: ENTRIES } } }),
      });

      const panel = await howTo();
      expect(
        within(panel)
          .getAllByRole("listitem")
          .map((step) => step.textContent),
      ).toEqual([
        "Play as a guest or with an account. Guests are ranked under their Guest name.",
        "Earn XP from games and daily quests.",
        "Games against the computer never count here.",
      ]);
      expect(within(panel).getByRole("link", { name: "Play a game" })).toHaveAttribute("href", "/");
    });

    it("says only this week counts on the weekly board", async () => {
      renderApp({ path: "/leaderboards/weekly", api: api() });

      expect(await howTo()).toHaveTextContent("Earn XP from games and daily quests this week.");
    });

    it("sends a game board's players to that game", async () => {
      renderApp({ path: "/leaderboards/chess", api: api() });

      const panel = await howTo();
      expect(panel).toHaveTextContent("Win a game of Chess against another player.");
      expect(within(panel).getByRole("link", { name: "Play Chess" })).toHaveAttribute("href", "/games/chess");
    });

    it("shows no numbers of its own, so it never pretends the site is busy", async () => {
      renderApp({ path: "/leaderboards/overall", api: api() });

      expect((await howTo()).textContent).not.toMatch(/\d/);
    });

    it("leaves a full board on its own", async () => {
      renderApp({
        path: "/leaderboards/overall",
        api: api({ boards: { overall: { board: boardInfo("overall"), entries: manyEntries } } }),
      });

      await screen.findByRole("list", { name: "Overall XP rankings" });
      expect(screen.queryByRole("complementary", { name: "How to get on the board" })).toBeNull();
    });

    it("waits for the board before showing it", () => {
      renderApp({ path: "/leaderboards/overall", api: api() });

      expect(screen.getByText("Loading the leaderboard…")).toBeInTheDocument();
      expect(screen.queryByRole("complementary", { name: "How to get on the board" })).toBeNull();
    });
  });
});

describe("LeaderboardPage and hidden names (CC-152)", () => {
  it("shows a hidden player's place and score without a name, and says why", async () => {
    const hidden = { rank: 2, displayName: "Hidden player", hidden: true, level: 2, score: 40 };
    renderApp({
      path: "/leaderboards/overall",
      api: api({
        boards: { overall: { board: boardInfo("overall"), entries: [entry(1, "ada", 900, 6), hidden] } },
      }),
    });

    await screen.findByRole("list", { name: "Overall XP rankings" });

    expect(rows()[1]).toHaveTextContent("2Hidden playerLv 240 XP");
    expect(within(rows()[1]).getByText("Hidden player").closest(".name")).toHaveClass("hidden");
    expect(within(rows()[0]).getByText("ada").closest(".name")).not.toHaveClass("hidden");
    expect(screen.getByText(/is a player under 18 or one who has not said their age/)).toBeInTheDocument();
  });

  it("says nothing about hidden names when every name shows", async () => {
    renderApp({
      path: "/leaderboards/overall",
      api: api({ boards: { overall: { board: boardInfo("overall"), entries: ENTRIES } } }),
    });

    await screen.findByRole("list", { name: "Overall XP rankings" });

    expect(screen.queryByText(/has not said their age/)).toBeNull();
  });

  it("draws each player's avatar and links an adult's name to their profile, never a hidden row (CC-034)", async () => {
    const user = userEvent.setup();
    const entries = [
      { ...entry(1, "ada", 900, 6), avatar: "crown", profile: "k3m9q2x7p4w8z1ab" },
      { ...entry(2, "Guest-7K2Q", 500), avatar: "owl" },
      { rank: 3, displayName: "Hidden player", hidden: true, level: 2, score: 40 },
    ];
    const view = renderApp({
      path: "/leaderboards/overall",
      api: api({ boards: { overall: { board: boardInfo("overall"), entries } } }),
    });
    await screen.findByRole("list", { name: "Overall XP rankings" });

    const links = rows().map((row) => within(row).queryByRole("link"));
    expect(links[0]).toHaveAttribute("href", "/players/k3m9q2x7p4w8z1ab");
    expect(links.slice(1)).toEqual([null, null]);
    expect(rows().map((row) => row.querySelectorAll(".name svg").length)).toEqual([1, 1, 1]);
    expect(rows()[0].querySelector(".name svg").innerHTML).not.toBe(
      rows()[2].querySelector(".name svg").innerHTML,
    );

    await user.click(links[0]);
    expect(view.url()).toBe("/players/k3m9q2x7p4w8z1ab");
  });
});
