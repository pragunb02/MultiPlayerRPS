import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, GUEST, NO_STREAKS, PROGRESS } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { useSaveProgress } from "./saveProgressContext.js";
import { movedAnything, savedMessage, winWorthSaving } from "./savedMessage.js";

// Asking guests to save their progress (CC-097): the room card after a win, "Save it" on the level-up toast, the
// streak-at-risk line, the header's "Save progress", and closing each for the rest of the visit.

const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const ME = { playerId: GUEST.id, displayName: GUEST.displayName, connected: true };
const BOB = { playerId: "guest_b", displayName: "Bob", connected: true };
const ROOM_PATH = "/games/ludo/rooms/AB2CD3";
const ROOM_NEXT = encodeURIComponent(ROOM_PATH);

const progress = (overrides = {}) => ({ ...PROGRESS, ...overrides });
/** After a guest's first win: 30 XP, one win, one match. */
const FIRST_WIN = progress({ xp: 30, xpIntoLevel: 30, matchesPlayed: 1, wins: 1 });
const streaks = (daily = {}) => ({
  win: { current: 1, best: 1 },
  daily: { current: 1, best: 1, lastDay: "2026-10-16", playedToday: true, atRisk: false, ...daily },
});
const AT_RISK = streaks({ current: 3, best: 3, lastDay: "2026-10-15", playedToday: false, atRisk: true });

const outcomes = {
  win: { status: "finished", result: "win", winners: [GUEST.id], reason: "reached-target" },
  loss: { status: "finished", result: "win", winners: [BOB.playerId], reason: "reached-target" },
  draw: { status: "finished", result: "draw", winners: [], reason: "board-full" },
};
/** A finished game of a board-less game (the generic room page), from the guest's seat. */
const finished = ({ code = "AB2CD3", outcome = outcomes.win, games = 1, ...overrides } = {}) => ({
  code,
  gameId: "ludo",
  status: "finished",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME, BOB],
  you: GUEST.id,
  game: { view: {}, activePlayers: [], outcome, number: games },
  rematch: { available: true },
  series: { games, wins: {} },
  ...overrides,
});
const playing = (overrides = {}) =>
  finished({
    status: "playing",
    game: {
      view: {},
      activePlayers: [GUEST.id],
      outcome: { status: "ongoing" },
      number: overrides.series?.games ?? 1,
    },
    ...overrides,
  });

/** An element's text without what is hidden from screen readers (`aria-hidden` subtrees). */
const textOutsideHidden = (element) => {
  const copy = element.cloneNode(true);
  copy.querySelectorAll("[aria-hidden='true']").forEach((hidden) => hidden.remove());
  return copy.textContent;
};
const card = () => screen.queryByRole("region", { name: "Save your progress" });
const banner = () => within(screen.getByRole("banner"));
const toasts = () => document.querySelector("[aria-live='polite'][role='status']");

/**
 * Opens the app at `path` (a room by default) as `identity` (`VISITOR`: no session); each room code answers
 * room:join with its view from `rooms`.
 */
const VISITOR = undefined;
function openRoom({
  rooms = { AB2CD3: finished() },
  path = ROOM_PATH,
  history = [],
  api = {},
  ...options
} = {}) {
  const identity = "identity" in options ? options.identity : GUEST;
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event, { code }) =>
    event === SOCKET_EVENTS.ROOM_JOIN ? rooms[code] : { left: true },
  );
  return renderApp({
    path,
    history,
    socket,
    api: fakeApi({
      getSession: async () => identity,
      getProgress: vi.fn().mockResolvedValue(FIRST_WIN),
      getStreaks: vi.fn().mockResolvedValue(streaks()),
      getMatches: vi.fn().mockResolvedValue({ matches: [] }),
      ...api,
    }),
  });
}

const pushProgress = (socket, payload) =>
  act(() =>
    socket.push(SOCKET_EVENTS.PROGRESS_UPDATED, {
      source: "match",
      xpGained: 30,
      leveledUp: false,
      ...payload,
    }),
  );

describe("the save-progress rules", () => {
  it.each([
    [{ wins: 1, xp: 30 }, true],
    [{ wins: 1, xp: 10 }, true],
    [{ wins: 2, xp: 49 }, false],
    [{ wins: 2, xp: 50 }, true],
    [{ wins: 0, xp: 60 }, true],
    [{ wins: 0, xp: 20 }, false],
  ])("a win is worth saving after %o: %s", (after, worth) => {
    expect(winWorthSaving(after)).toBe(worth);
  });

  it.each([
    [undefined, false],
    [{ xp: 0, matchesPlayed: 0 }, false],
    [{ xp: 20, matchesPlayed: 0 }, true],
    [{ xp: 0, matchesPlayed: 1 }, true],
  ])("guest games moved: %o → %s", (carriedOver, moved) => {
    expect(movedAnything(carriedOver)).toBe(moved);
  });

  it("words the confirmation with the account's level, XP and matches", () => {
    expect(savedMessage({ level: 2, xp: 50, matchesPlayed: 2 })).toBe(
      "Your progress is now saved: Level 2 · 50 XP · 2 matches",
    );
  });

  it("can only be asked inside the provider", () => {
    const Probe = () => useSaveProgress() && null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/inside <SaveProgressProvider>/);
    vi.restoreAllMocks();
  });
});

describe("the room card after a guest's win", () => {
  it("shows what an account keeps, with sign up and log in links that come back to the room", async () => {
    openRoom();

    const region = await screen.findByRole("region", { name: "Save your progress" });
    const kept = within(region).getByRole("list", { name: "What you'd keep" });
    expect(
      within(kept)
        .getAllByRole("listitem")
        // What is read out: the badge and the flame are decoration (their own digits are hidden).
        .map((li) => textOutsideHidden(li)),
    ).toEqual(["Level 1", "30 XP", "1 win", "1-day streak"]);
    expect(within(region).getByRole("link", { name: "Sign up — keep it" })).toHaveAttribute(
      "href",
      `/signup?next=${ROOM_NEXT}`,
    );
    expect(within(region).getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=${ROOM_NEXT}`,
    );
    // Under the result and the rematch offer, never in front of them.
    const result = screen.getByRole("heading", { name: "You won!" });
    expect(result.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.querySelector("[style]")).toBeNull();
  });

  it("waits for the win to be counted, then follows the numbers as they come in", async () => {
    const { socket } = openRoom({ api: { getProgress: vi.fn().mockResolvedValue(PROGRESS) } });
    await screen.findByRole("heading", { name: "You won!" });
    expect(card()).toBeNull();

    pushProgress(socket, { progress: FIRST_WIN });
    expect(await screen.findByRole("region", { name: "Save your progress" })).toHaveTextContent("30 XP");

    // The day's "Get a win" quest pays out right after; the card follows.
    pushProgress(socket, {
      source: "quest",
      xpGained: 20,
      key: "quest:2026-10-16:win-1",
      progress: progress({ xp: 50, level: 2, wins: 1 }),
    });
    expect(card()).toHaveTextContent("Level 2");
    expect(card()).toHaveTextContent("50 XP");
    act(() => socket.push(SOCKET_EVENTS.STREAKS_UPDATED, { streaks: streaks({ current: 2 }) }));
    expect(card()).toHaveTextContent("2-day streak");
  });

  it("keeps a push that arrives before the first load answers", async () => {
    let answer;
    const getProgress = vi.fn(() => new Promise((resolve) => (answer = resolve)));
    const { socket } = openRoom({ api: { getProgress } });
    await screen.findByRole("heading", { name: "You won!" });

    pushProgress(socket, { progress: FIRST_WIN });
    await act(async () => answer(PROGRESS));

    expect(card()).toHaveTextContent("1 win");
  });

  it.each([
    ["a loss", finished({ outcome: outcomes.loss })],
    ["a draw", finished({ outcome: outcomes.draw })],
    ["watching", finished({ you: "" })],
  ])("isn't offered after %s", async (_name, room) => {
    openRoom({ rooms: { AB2CD3: room } });
    await screen.findByRole("region", { name: /won|lost|draw/i });

    expect(card()).toBeNull();
  });

  it("isn't offered for a later win while the guest has little XP", async () => {
    openRoom({
      api: { getProgress: vi.fn().mockResolvedValue(progress({ xp: 40, wins: 2, matchesPlayed: 2 })) },
    });
    await screen.findByRole("heading", { name: "You won!" });

    expect(card()).toBeNull();
  });

  it("is offered again for a later win once the guest has 50 XP", async () => {
    openRoom({
      api: {
        getProgress: vi.fn().mockResolvedValue(progress({ xp: 90, level: 2, wins: 3, matchesPlayed: 3 })),
      },
    });

    expect(await screen.findByRole("region", { name: "Save your progress" })).toHaveTextContent("3 wins");
  });

  it("leaves the streak out when streaks can't be loaded", async () => {
    openRoom({
      api: { getStreaks: vi.fn().mockRejectedValue(new AppRequestError({ code: "NETWORK", message: "x" })) },
    });

    const region = await screen.findByRole("region", { name: "Save your progress" });
    expect(region).not.toHaveTextContent("streak");
  });

  it("isn't offered when the guest's progress can't be loaded", async () => {
    openRoom({
      api: { getProgress: vi.fn().mockRejectedValue(new AppRequestError({ code: "NETWORK", message: "x" })) },
    });
    await screen.findByRole("heading", { name: "You won!" });

    expect(card()).toBeNull();
  });

  it("is offered once per room: a rematch won in the same room doesn't bring it back", async () => {
    const { socket } = openRoom();
    await screen.findByRole("region", { name: "Save your progress" });

    act(() => socket.push(SOCKET_EVENTS.ROOM_UPDATED, playing({ series: { games: 2, wins: {} } })));
    expect(card()).toBeNull();
    act(() => socket.push(SOCKET_EVENTS.ROOM_UPDATED, finished({ games: 2 })));
    pushProgress(socket, { progress: progress({ xp: 60, level: 2, wins: 2, matchesPlayed: 2 }) });

    expect(await screen.findByRole("heading", { name: "You won!" })).toBeInTheDocument();
    expect(card()).toBeNull();
  });

  it("is offered in each room, and stays while the same game's result is on screen", async () => {
    const { back, socket } = openRoom({
      rooms: { AB2CD3: finished(), XY7ZW8: finished({ code: "XY7ZW8" }) },
      path: "/games/ludo/rooms/XY7ZW8",
      history: [ROOM_PATH],
    });
    await screen.findByRole("region", { name: "Save your progress" });
    act(() => socket.push(SOCKET_EVENTS.ROOM_UPDATED, finished({ code: "XY7ZW8" })));
    expect(card()).not.toBeNull();

    back();

    expect(await screen.findByRole("region", { name: "Save your progress" })).toBeInTheDocument();
  });

  it("closes with × and stays closed in other rooms for the rest of the visit", async () => {
    const user = userEvent.setup();
    const { back } = openRoom({
      rooms: { AB2CD3: finished(), XY7ZW8: finished({ code: "XY7ZW8" }) },
      path: "/games/ludo/rooms/XY7ZW8",
      history: [ROOM_PATH],
    });

    await user.click(await screen.findByRole("button", { name: "Close: save your progress" }));
    expect(card()).toBeNull();
    back();

    expect(await screen.findByRole("heading", { name: "You won!" })).toBeInTheDocument();
    expect(card()).toBeNull();
  });

  it("is never shown to an account holder, who loads no guest data", async () => {
    const { api } = openRoom({
      identity: USER,
      rooms: {
        AB2CD3: finished({
          you: USER.id,
          seats: [{ ...ME, playerId: USER.id }, BOB],
          game: { view: {}, activePlayers: [], outcome: { ...outcomes.win, winners: [USER.id] } },
        }),
      },
    });
    await screen.findByRole("heading", { name: "You won!" });

    expect(card()).toBeNull();
    expect(api.getStreaks).not.toHaveBeenCalled();
  });

  it("leads to sign-up and back into the room as the account, where it's gone", async () => {
    const user = userEvent.setup();
    const { url } = openRoom({
      api: {
        signup: async () => ({ identity: USER, carriedOver: { xp: 30, matchesPlayed: 1, matches: 1 } }),
      },
    });
    await user.click(await screen.findByRole("link", { name: "Sign up — keep it" }));
    expect(url()).toBe(`/signup?next=${ROOM_NEXT}`);

    await user.type(screen.getByLabelText("Username"), "Riya");
    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("Your progress is now saved: Level 1 · 30 XP · 1 match"),
    ).toBeInTheDocument();
    await waitFor(() => expect(url()).toBe(ROOM_PATH));
    await screen.findByRole("heading", { name: "You won!" });
    expect(card()).toBeNull();
  });
});

describe("the level-up toast", () => {
  afterEach(() => vi.useRealTimers());

  const levelUp = { xpGained: 30, leveledUp: true, progress: progress({ level: 2, xp: 50, wins: 1 }) };

  it("offers a guest 'Save it': sign up and come back to this page", async () => {
    const { socket } = openRoom({ path: "/profile" });
    await screen.findByRole("heading", { level: 1, name: GUEST.displayName });

    pushProgress(socket, levelUp);

    expect(toasts()).toHaveTextContent("Level up! You reached level 2");
    expect(within(toasts()).getByRole("link", { name: "Save it" })).toHaveAttribute(
      "href",
      "/signup?next=%2Fprofile",
    );
  });

  it("closes with ×, and later level-ups don't offer it again this visit", async () => {
    const user = userEvent.setup();
    const { socket } = openRoom({ path: "/profile" });
    await screen.findByRole("heading", { level: 1, name: GUEST.displayName });
    pushProgress(socket, levelUp);

    await user.click(within(toasts()).getByRole("button", { name: "Close: save your level" }));
    expect(toasts()).not.toHaveTextContent("Level up!");
    pushProgress(socket, { ...levelUp, progress: progress({ level: 3, xp: 150 }) });

    expect(toasts()).toHaveTextContent("Level up! You reached level 3");
    expect(within(toasts()).queryByRole("link", { name: "Save it" })).toBeNull();
  });

  it("stays twice as long as a plain toast, since there is something to do", async () => {
    const { socket } = openRoom({ path: "/profile" });
    await screen.findByRole("heading", { level: 1, name: GUEST.displayName });
    vi.useFakeTimers();
    pushProgress(socket, levelUp);

    act(() => vi.advanceTimersByTime(4_000));
    expect(toasts()).toHaveTextContent("Level up!");
    act(() => vi.advanceTimersByTime(4_000));
    expect(toasts()).not.toHaveTextContent("Level up!");
  });

  it.each([
    ["an account holder", USER],
    ["a visitor", VISITOR],
  ])("has no 'Save it' for %s", async (_who, identity) => {
    const { socket } = openRoom({ identity, path: "/leaderboards/overall" });
    await screen.findByRole("heading", { level: 1 });

    pushProgress(socket, levelUp);

    expect(toasts()).toHaveTextContent("Level up! You reached level 2");
    expect(within(toasts()).queryByRole("link")).toBeNull();
  });
});

describe("the streak-at-risk line", () => {
  const line = () => screen.queryByText(/Play today to keep your 3-day streak —/);

  it("asks a guest on the home quest card to play today and sign up so it's never lost", async () => {
    openRoom({ path: "/", api: { getStreaks: vi.fn().mockResolvedValue(AT_RISK) } });

    const quests = await screen.findByRole("region", { name: "Daily quests" });
    expect(await within(quests).findByText(/Play today to keep your 3-day streak —/)).toBeInTheDocument();
    expect(within(quests).getByRole("link", { name: "sign up so it's never lost" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  it("replaces the general sign-up nudge in the profile's player console", async () => {
    openRoom({ path: "/profile", api: { getStreaks: vi.fn().mockResolvedValue(AT_RISK) } });

    const panel = await screen.findByRole("region", { name: "Player console" });
    expect(await within(panel).findByRole("link", { name: "sign up so it's never lost" })).toHaveAttribute(
      "href",
      "/signup?next=%2Fprofile",
    );
    expect(within(panel).queryByRole("link", { name: /Sign up to keep/ })).toBeNull();
  });

  it("closes with ×, on home and the profile alike, and the general nudge comes back", async () => {
    const user = userEvent.setup();
    openRoom({ path: "/", api: { getStreaks: vi.fn().mockResolvedValue(AT_RISK) } });
    await user.click(await screen.findByRole("button", { name: "Close: streak reminder" }));
    expect(line()).toBeNull();

    await user.click(screen.getByRole("link", { name: "Open your player console" }));

    const panel = await screen.findByRole("region", { name: "Player console" });
    expect(await within(panel).findByRole("link", { name: /Sign up to keep/ })).toBeInTheDocument();
    expect(line()).toBeNull();
  });

  it("appears when a pushed streak puts it at risk", async () => {
    const getStreaks = vi.fn().mockResolvedValue(NO_STREAKS);
    const { socket } = openRoom({ path: "/", api: { getStreaks } });
    await screen.findByRole("region", { name: "Daily quests" });
    // The first answer is in before the push, so a slow test machine cannot let it overwrite the pushed streak.
    await waitFor(() => expect(getStreaks).toHaveBeenCalled());
    await act(() => getStreaks.mock.results[0].value);
    expect(line()).toBeNull();

    act(() => socket.push(SOCKET_EVENTS.STREAKS_UPDATED, { streaks: AT_RISK }));

    expect(line()).not.toBeNull();
  });

  it.each([
    ["a one-day streak", streaks({ current: 1, playedToday: false, atRisk: true })],
    ["a streak already kept today", streaks({ current: 3 })],
  ])("says nothing for %s", async (_name, value) => {
    openRoom({ path: "/", api: { getStreaks: vi.fn().mockResolvedValue(value) } });
    await screen.findByRole("region", { name: "Daily quests" });
    await screen.findByText(/done/);

    expect(screen.queryByText(/Play today to keep/)).toBeNull();
  });

  it("is never shown to an account holder", async () => {
    openRoom({ identity: USER, path: "/profile", api: { getStreaks: vi.fn().mockResolvedValue(AT_RISK) } });
    const panel = await screen.findByRole("region", { name: "Player console" });
    await within(panel).findByText("Daily streak");

    expect(within(panel).queryByText(/sign up so it's never lost/)).toBeNull();
  });
});

describe("the header's sign-up link", () => {
  it("reads 'Save progress' for a guest with XP, still a sign-up link back to this page", async () => {
    openRoom({ path: "/profile" });

    const link = await banner().findByRole("link", { name: "Save progress — sign up" });
    expect(link).toHaveAttribute("href", "/signup?next=%2Fprofile");
    expect(link).toHaveTextContent(/^Save progress/);
  });

  it("says 'Sign up' to a guest with no XP yet, and changes once XP comes in", async () => {
    const { socket } = openRoom({
      path: "/profile",
      api: { getProgress: vi.fn().mockResolvedValue(PROGRESS) },
    });
    expect(await banner().findByRole("link", { name: "Sign up" })).toBeInTheDocument();

    pushProgress(socket, { progress: FIRST_WIN });

    expect(banner().getByRole("link", { name: "Save progress — sign up" })).toBeInTheDocument();
  });

  it("says 'Sign up' to a visitor, who loads no progress", async () => {
    const { api } = openRoom({ identity: VISITOR, path: "/" });

    expect(await banner().findByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
    expect(api.getProgress).not.toHaveBeenCalled();
    expect(api.getStreaks).not.toHaveBeenCalled();
  });
});
