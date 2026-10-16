import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { ServicesProvider } from "../app/ServicesProvider.jsx";
import { AppRequestError } from "../lib/errors.js";
import { achievement, fakeApi, fakeSocket, NO_STREAKS, QUESTS } from "../testing/fakes.js";
import { installMatchMedia } from "../testing/matchMedia.js";
import { AchievementGrid } from "./Achievements/AchievementGrid.jsx";
import { CELEBRATION_MS, GamificationToasts } from "./GamificationToasts.jsx";
import { ProgressToasts } from "./ProgressToasts.jsx";
import { DailyQuests } from "./Quests/DailyQuests.jsx";
import { resetsIn } from "./Quests/resetsIn.js";
import { StreakCard } from "./Streaks/StreakCard.jsx";
import { ToastProvider } from "./Toast/ToastProvider.jsx";

const down = () => new AppRequestError({ code: "NETWORK", message: "Can't reach ClassiCade" });

function renderWith(ui, { api = fakeApi(), socket = fakeSocket() } = {}) {
  render(
    <MemoryRouter>
      <ServicesProvider services={{ api, socket }}>
        <ToastProvider>{ui}</ToastProvider>
      </ServicesProvider>
    </MemoryRouter>,
  );
  return { api, socket };
}

const quest = (index, overrides) => ({ ...QUESTS.items[index], ...overrides });
const questsWith = (...items) => ({ ...QUESTS, items: [...items, ...QUESTS.items.slice(items.length)] });

describe("resetsIn", () => {
  it.each([
    [5 * 3_600_000 + 12 * 60_000, "Resets in 5h 12m"],
    [5 * 3_600_000 + 11 * 60_000 + 1, "Resets in 5h 12m"],
    [12 * 60_000, "Resets in 12m"],
    [1, "Resets in 1m"],
    [0, "Resetting now…"],
  ])("%i ms → %s", (ms, text) => {
    expect(resetsIn(ms)).toBe(text);
  });
});

describe("DailyQuests", () => {
  afterEach(() => vi.useRealTimers());

  it("lists today's quests with progress, reward and the reset countdown", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 16, 18, 48), shouldAdvanceTime: true });
    renderWith(<DailyQuests />, {
      api: fakeApi({ getQuests: vi.fn().mockResolvedValue(questsWith(quest(0, { progress: 1 }))) }),
    });

    const list = await screen.findByRole("list", { name: "Today's quests" });
    const [warmUp] = within(list).getAllByRole("listitem");
    expect(warmUp).toHaveTextContent("Warm-up");
    expect(warmUp).toHaveTextContent("1/3");
    expect(warmUp).toHaveTextContent("+20 XP");
    expect(within(warmUp).getByRole("progressbar", { name: "Warm-up progress" })).toHaveAttribute(
      "value",
      "1",
    );
    expect(screen.getByText("0/3 done")).toBeInTheDocument();
    expect(screen.getByText("Daily sweep: finish all three for +30 XP")).toBeInTheDocument();
    expect(screen.getByText("Resets in 5h 12m")).toHaveAttribute("aria-live", "off");
    expect(screen.queryByText(/Play your first match/)).toBeNull();
  });

  it("marks completed quests and the sweep", async () => {
    const done = { completedAt: Date.UTC(2026, 9, 16, 12) };
    renderWith(<DailyQuests />, {
      api: fakeApi({
        getQuests: vi.fn().mockResolvedValue({
          ...QUESTS,
          items: QUESTS.items.map((item) => ({ ...item, ...done, progress: item.target })),
          sweep: { bonusXp: 30, ...done },
        }),
      }),
    });

    expect(await screen.findByText("3/3 done")).toBeInTheDocument();
    expect(screen.getAllByText(/Completed · \+\d+ XP/)).toHaveLength(3);
    expect(screen.getByText("Daily sweep complete! +30 XP")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("invites a player who hasn't played today to start", async () => {
    renderWith(<DailyQuests />);

    expect(await screen.findByText("Play your first match to start quests.")).toBeInTheDocument();
  });

  it("updates live when the server pushes new quest progress", async () => {
    const { socket } = renderWith(<DailyQuests />);
    await screen.findByText("0/3 done");

    act(() =>
      socket.push(SOCKET_EVENTS.QUESTS_UPDATED, {
        quests: questsWith(quest(0, { progress: 1 }), quest(1, { progress: 1, completedAt: 1 })),
      }),
    );

    expect(screen.getByText("1/3 done")).toBeInTheDocument();
  });

  it("ignores a push that arrives before the quests have loaded", async () => {
    let resolve;
    const api = fakeApi({ getQuests: vi.fn(() => new Promise((r) => (resolve = r))) });
    const { socket } = renderWith(<DailyQuests />, { api });

    act(() => socket.push(SOCKET_EVENTS.QUESTS_UPDATED, { quests: questsWith(quest(0, { progress: 2 })) }));
    await act(async () => resolve(QUESTS));

    expect(screen.getByText("0/3 done")).toBeInTheDocument();
    expect(screen.getByText("Play your first match to start quests.")).toBeInTheDocument();
  });

  it("explains a failure and tries again on request", async () => {
    const user = userEvent.setup();
    const getQuests = vi.fn().mockRejectedValueOnce(down()).mockResolvedValue(QUESTS);
    renderWith(<DailyQuests />, { api: fakeApi({ getQuests }) });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load quests. Can't reach ClassiCade",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("0/3 done")).toBeInTheDocument();
    expect(getQuests).toHaveBeenCalledTimes(2);
  });

  it("loads the next day's quests when the countdown runs out", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 16, 23, 59, 30) });
    const tomorrow = { ...QUESTS, day: "2026-10-17", resetsAt: Date.UTC(2026, 9, 18) };
    const getQuests = vi.fn().mockResolvedValueOnce(QUESTS).mockResolvedValue(tomorrow);
    renderWith(<DailyQuests />, { api: fakeApi({ getQuests }) });
    await act(async () => {});
    expect(screen.getByText("Resets in 1m")).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(60_000));
    await act(async () => {});

    expect(getQuests).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Resets in 24h 0m")).toBeInTheDocument();
  });

  it("counts down once a minute", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 16, 18, 48) });
    renderWith(<DailyQuests />);
    await act(async () => {});
    expect(screen.getByText("Resets in 5h 12m")).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTime(60_000));

    expect(screen.getByText("Resets in 5h 11m")).toBeInTheDocument();
  });

  it("retries a minute later, not in a loop, when the reset time has already passed here", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 0, 0, 5) });
    const getQuests = vi.fn().mockResolvedValue(QUESTS);
    renderWith(<DailyQuests />, { api: fakeApi({ getQuests }) });
    await act(async () => {});
    expect(screen.getByText("Resetting now…")).toBeInTheDocument();
    expect(getQuests).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(60_000));

    expect(getQuests).toHaveBeenCalledTimes(2);
  });

  it("has a compact form for the home page that links to the full console", async () => {
    renderWith(<DailyQuests compact />, {
      api: fakeApi({
        getQuests: vi
          .fn()
          .mockResolvedValue(questsWith(quest(0, { progress: 2 }), quest(1, { completedAt: 5 }))),
      }),
    });

    const list = await screen.findByRole("list", { name: "Today's quests" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Warm-up 2/3", "First blood ✓", "Rock on 0/2"]);
    expect(screen.getByRole("heading", { level: 2, name: "Daily quests" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open your player console" })).toHaveAttribute(
      "href",
      "/profile",
    );
  });
});

describe("StreakCard", () => {
  const streaks = (daily, win = { current: 0, best: 0 }) => ({
    win,
    daily: { current: 0, best: 0, lastDay: "", playedToday: false, atRisk: false, ...daily },
  });

  it("starts at zero with an invitation", async () => {
    renderWith(<StreakCard />);

    expect(await screen.findByText("No streak yet. Play a match today to start one.")).toBeInTheDocument();
    expect(screen.getByText("Daily streak").nextSibling).toHaveTextContent("0 days");
  });

  it("shows an active streak, the best ones and the win streak", async () => {
    renderWith(<StreakCard />, {
      api: fakeApi({
        getStreaks: vi
          .fn()
          .mockResolvedValue(
            streaks(
              { current: 1, best: 4, playedToday: true, lastDay: "2026-10-16" },
              { current: 2, best: 5 },
            ),
          ),
      }),
    });

    expect(await screen.findByText(/You've played today/)).toBeInTheDocument();
    expect(screen.getByText("Daily streak").nextSibling).toHaveTextContent("1 day");
    expect(screen.getByText("Best daily streak").nextSibling).toHaveTextContent("4 days");
    expect(screen.getByText("Win streak").nextSibling).toHaveTextContent("2 wins");
    expect(screen.getByText("Best win streak").nextSibling).toHaveTextContent("5 wins");
  });

  it("warns when the streak is at risk", async () => {
    renderWith(<StreakCard />, {
      api: fakeApi({ getStreaks: vi.fn().mockResolvedValue(streaks({ current: 4, best: 4, atRisk: true })) }),
    });

    expect(await screen.findByText("Play today to keep your 4-day streak")).toBeInTheDocument();
  });

  it("updates live, and shows a single win as '1 win'", async () => {
    const { socket } = renderWith(<StreakCard />);
    await screen.findByText(/No streak yet/);

    act(() =>
      socket.push(SOCKET_EVENTS.STREAKS_UPDATED, {
        streaks: streaks({ current: 1, best: 1, playedToday: true }, { current: 1, best: 1 }),
      }),
    );

    expect(screen.getByText("Win streak").nextSibling).toHaveTextContent("1 win");
  });

  it("explains a failure and tries again on request", async () => {
    const user = userEvent.setup();
    const getStreaks = vi.fn().mockRejectedValueOnce(down()).mockResolvedValue(NO_STREAKS);
    renderWith(<StreakCard />, { api: fakeApi({ getStreaks }) });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load streaks. Can't reach ClassiCade",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(/No streak yet/)).toBeInTheDocument();
  });
});

describe("AchievementGrid", () => {
  const UNLOCKED_AT = Date.UTC(2026, 9, 16, 12);

  it("shows locked achievements with progress and unlocked ones with their date", async () => {
    renderWith(<AchievementGrid />, {
      api: fakeApi({
        getAchievements: vi.fn().mockResolvedValue([
          achievement({
            id: "first-win",
            name: "First Victory",
            tier: "bronze",
            icon: "trophy",
            unlockedAt: UNLOCKED_AT,
            progress: { current: 1, target: 1 },
          }),
          achievement(),
        ]),
      }),
    });

    const list = await screen.findByRole("list", { name: "Achievements" });
    const [won, locked] = within(list).getAllByRole("listitem");
    expect(won).toHaveTextContent("First Victory");
    expect(won).toHaveTextContent("Bronze");
    expect(
      within(won)
        .getByText(/Unlocked/)
        .querySelector("time"),
    ).toHaveAttribute("datetime", new Date(UNLOCKED_AT).toISOString());
    expect(locked).toHaveTextContent("Locked.");
    expect(locked).toHaveTextContent("3/10");
    expect(within(locked).getByRole("progressbar", { name: "Rising Star progress" })).toHaveAttribute(
      "max",
      "10",
    );
    expect(screen.getByText("1/2 unlocked")).toBeInTheDocument();
    expect(screen.queryByText(/Play your first match/)).toBeNull();
  });

  it("names an unknown tier as it is, and marks the badge with its icon name for the art", async () => {
    renderWith(<AchievementGrid />, {
      api: fakeApi({
        getAchievements: vi.fn().mockResolvedValue([achievement({ tier: "mythic", icon: "dragon" })]),
      }),
    });

    expect(await screen.findByText("mythic")).toBeInTheDocument();
    expect(document.querySelector("[data-icon='dragon']")).toHaveAttribute("aria-hidden", "true");
  });

  it("invites a new player to play, and unlocks live when the server says so", async () => {
    const { socket } = renderWith(<AchievementGrid />, {
      api: fakeApi({ getAchievements: vi.fn().mockResolvedValue([achievement(), achievement({ id: "x" })]) }),
    });
    expect(
      await screen.findByText("Play your first match to unlock your first achievement."),
    ).toBeInTheDocument();

    act(() =>
      socket.push(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, {
        achievements: [achievement({ unlockedAt: UNLOCKED_AT, progress: { current: 10, target: 10 } })],
      }),
    );

    expect(screen.getByText("1/2 unlocked")).toBeInTheDocument();
  });

  it("explains a failure and tries again on request", async () => {
    const user = userEvent.setup();
    const getAchievements = vi.fn().mockRejectedValueOnce(down()).mockResolvedValue([]);
    renderWith(<AchievementGrid />, { api: fakeApi({ getAchievements }) });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load achievements. Can't reach ClassiCade",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("0/0 unlocked")).toBeInTheDocument();
  });
});

describe("GamificationToasts", () => {
  it("announces each newly unlocked achievement", async () => {
    const { socket } = renderWith(<GamificationToasts />);

    act(() =>
      socket.push(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, {
        achievements: [achievement({ name: "First Move" }), achievement({ name: "Hat Trick" })],
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("Achievement unlocked: First Move");
    expect(screen.getByRole("status")).toHaveTextContent("Achievement unlocked: Hat Trick");
  });

  it.each([
    [{ source: "quest", key: "quest:2026-10-16:win-3", xpGained: 40 }, "Quest complete! +40 XP"],
    [{ source: "quest", key: "quest:2026-10-16:sweep", xpGained: 30 }, "Daily sweep! +30 XP"],
  ])("celebrates quest XP: %o", (payload, text) => {
    const { socket } = renderWith(<GamificationToasts />);

    act(() => socket.push(SOCKET_EVENTS.PROGRESS_UPDATED, { leveledUp: false, progress: {}, ...payload }));

    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("leaves match XP to the progress toasts, which leave quest XP to it", () => {
    const { socket } = renderWith(
      <>
        <ProgressToasts />
        <GamificationToasts />
      </>,
    );

    act(() =>
      socket.push(SOCKET_EVENTS.PROGRESS_UPDATED, {
        source: "match",
        key: "m1",
        xpGained: 30,
        leveledUp: false,
        progress: { level: 1 },
      }),
    );
    act(() =>
      socket.push(SOCKET_EVENTS.PROGRESS_UPDATED, {
        source: "quest",
        key: "quest:2026-10-16:win-1",
        xpGained: 20,
        leveledUp: false,
        progress: { level: 1 },
      }),
    );

    expect(screen.getByRole("status").textContent).toBe("+30 XPQuest complete! +20 XP");
  });

  it("stops listening when unmounted", () => {
    const socket = fakeSocket();
    const view = render(
      <ServicesProvider services={{ api: fakeApi(), socket }}>
        <ToastProvider>
          <GamificationToasts />
        </ToastProvider>
      </ServicesProvider>,
    );

    view.unmount();

    expect(() =>
      socket.push(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, { achievements: [achievement()] }),
    ).not.toThrow();
    expect(socket.on).toHaveBeenCalledTimes(2);
  });
});

describe("arcade art (CC-087)", () => {
  afterEach(() => vi.useRealTimers());

  const effect = (name) => document.querySelector(`[data-effect='${name}']`);

  it("draws each achievement's medal in its tier, padlocked while locked, bronze for an unknown tier", async () => {
    renderWith(<AchievementGrid />, {
      api: fakeApi({
        getAchievements: vi
          .fn()
          .mockResolvedValue([
            achievement({ id: "a", icon: "trophy", tier: "gold", unlockedAt: Date.UTC(2026, 9, 16) }),
            achievement({ id: "b", icon: "flame", tier: "silver" }),
            achievement({ id: "c", icon: "dragon", tier: "mythic" }),
          ]),
      }),
    });

    const [gold, locked, unknown] = within(
      await screen.findByRole("list", { name: "Achievements" }),
    ).getAllByRole("listitem");
    expect(gold).toHaveClass("gold");
    expect(gold.querySelector("svg circle")).toHaveClass("gold");
    expect(gold.querySelector("svg")).toHaveClass("unlocked");
    expect(locked).toHaveClass("silver", "locked");
    expect(locked.querySelector("svg")).toHaveClass("isLocked");
    expect(locked.querySelector("svg circle")).toHaveClass("locked");
    expect(unknown).not.toHaveClass("bronze", "silver", "gold", "platinum");
    expect(unknown.querySelector("svg circle")).not.toHaveClass("bronze"); // locked: grey silhouette
  });

  it("draws an unlocked achievement of an unknown tier in bronze", async () => {
    renderWith(<AchievementGrid />, {
      api: fakeApi({
        getAchievements: vi
          .fn()
          .mockResolvedValue([achievement({ tier: "mythic", unlockedAt: Date.UTC(2026, 9, 16) })]),
      }),
    });

    const [item] = within(await screen.findByRole("list", { name: "Achievements" })).getAllByRole("listitem");
    expect(item.querySelector("svg circle")).toHaveClass("bronze");
  });

  it("shows the daily streak as a flame, unlit at zero, hidden from screen readers", async () => {
    renderWith(<StreakCard />, {
      api: fakeApi({
        getStreaks: vi.fn().mockResolvedValue({
          ...NO_STREAKS,
          daily: { current: 4, best: 4, lastDay: "2026-10-15", playedToday: false, atRisk: true },
        }),
      }),
    });

    await screen.findByText("Play today to keep your 4-day streak");
    const flame = document.querySelector(".flameWrap");
    expect(flame).toHaveAttribute("aria-hidden", "true");
    expect(flame.querySelector(".streak")).not.toHaveClass("inactive");
    expect(flame).toHaveTextContent("4");
  });

  it("leaves the flame unlit for a new player", async () => {
    renderWith(<StreakCard />);

    await screen.findByText(/No streak yet/);
    expect(document.querySelector(".flameWrap .streak")).toHaveClass("inactive");
  });

  it("pictures game quests with the game's glyph and the others with a scroll, gold once done", async () => {
    renderWith(<DailyQuests />, {
      api: fakeApi({
        getQuests: vi
          .fn()
          .mockResolvedValue(
            questsWith(quest(0), quest(1, { progress: 1, completedAt: Date.UTC(2026, 9, 16) })),
          ),
      }),
    });

    const [warmUp, firstBlood, rockOn] = within(
      await screen.findByRole("list", { name: "Today's quests" }),
    ).getAllByRole("listitem");
    expect(warmUp.querySelector(".icon")).toHaveAttribute("aria-hidden", "true");
    expect(warmUp.querySelector(".icon svg circle")).toHaveClass("silver");
    expect(firstBlood.querySelector(".icon svg circle")).toHaveClass("gold");
    expect(rockOn.querySelector(".icon svg")).toHaveClass("rps");
  });

  it("puts the medal in the unlock toast and showers confetti once, then clears it", () => {
    vi.useFakeTimers();
    const { socket } = renderWith(<GamificationToasts />);

    act(() =>
      socket.push(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, {
        achievements: [achievement({ name: "First Move", icon: "flag", tier: "bronze" })],
      }),
    );

    const art = screen.getByRole("status").querySelector(".art");
    expect(art).toHaveAttribute("aria-hidden", "true");
    expect(art.querySelector("circle")).toHaveClass("bronze");
    expect(art.parentElement).toHaveClass("withArt");
    expect(effect("confetti")).not.toBeNull();

    act(() => vi.advanceTimersByTime(CELEBRATION_MS));
    expect(effect("confetti")).toBeNull();
  });

  it("draws an unlocked achievement of an unknown tier in bronze in its toast, and ignores an empty unlock", () => {
    const { socket } = renderWith(<GamificationToasts />);

    act(() => socket.push(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, { achievements: [] }));
    expect(effect("confetti")).toBeNull();

    act(() =>
      socket.push(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, { achievements: [achievement({ tier: "mythic" })] }),
    );
    expect(screen.getByRole("status").querySelector(".art circle")).toHaveClass("bronze");
  });

  it("raises the quest XP beside the toasts, outside the announced region", () => {
    vi.useFakeTimers();
    const { socket } = renderWith(<GamificationToasts />);

    act(() =>
      socket.push(SOCKET_EVENTS.PROGRESS_UPDATED, {
        source: "quest",
        key: "quest:2026-10-16:win-1",
        xpGained: 20,
        leveledUp: false,
        progress: {},
      }),
    );

    expect(screen.getByRole("status").textContent).toBe("Quest complete! +20 XP");
    expect(screen.getByRole("status").querySelector(".art circle")).toHaveClass("gold");
    expect(effect("xp-pop")).toHaveTextContent("+20 XP");
    expect(effect("xp-pop").parentElement).toHaveAttribute("aria-hidden", "true");

    act(() => vi.advanceTimersByTime(CELEBRATION_MS));
    expect(effect("xp-pop")).toBeNull();
  });

  it("keeps the words and drops the confetti and the XP pop under reduced motion", () => {
    installMatchMedia({ reducedMotion: true });
    const { socket } = renderWith(<GamificationToasts />);

    act(() => socket.push(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, { achievements: [achievement()] }));
    act(() =>
      socket.push(SOCKET_EVENTS.PROGRESS_UPDATED, {
        source: "quest",
        key: "quest:2026-10-16:sweep",
        xpGained: 30,
        leveledUp: false,
        progress: {},
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("Achievement unlocked: Rising Star");
    expect(screen.getByRole("status")).toHaveTextContent("Daily sweep! +30 XP");
    expect(effect("confetti")).toBeNull();
    expect(effect("xp-pop")).toBeNull();
  });
});
