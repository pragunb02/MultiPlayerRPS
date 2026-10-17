import { vi } from "vitest";
import { AppRequestError } from "../lib/errors.js";

export const GUEST = Object.freeze({
  kind: "guest",
  id: "guest_00000000-0000-4000-8000-000000000001",
  displayName: "Guest-T001",
});
export const GAMES = Object.freeze([
  { id: "rps", slug: "rock-paper-scissors", name: "Rock Paper Scissors", minPlayers: 2, maxPlayers: 2 },
  { id: "chess", slug: "chess", name: "Chess", minPlayers: 2, maxPlayers: 2 },
]);

/** A player with no streaks yet. */
export const NO_STREAKS = Object.freeze({
  win: { current: 0, best: 0 },
  daily: { current: 0, best: 0, lastDay: "", playedToday: false, atRisk: false },
});

/** Today's quests (2026-10-16), untouched. */
export const QUESTS = Object.freeze({
  day: "2026-10-16",
  resetsAt: Date.UTC(2026, 9, 17),
  items: [
    {
      id: "play-3",
      name: "Warm-up",
      description: "Finish 3 matches",
      gameId: null,
      target: 3,
      progress: 0,
      bonusXp: 20,
      completedAt: null,
    },
    {
      id: "win-1",
      name: "First blood",
      description: "Get a win",
      gameId: null,
      target: 1,
      progress: 0,
      bonusXp: 20,
      completedAt: null,
    },
    {
      id: "rps-win-2",
      name: "Rock on",
      description: "Win 2 Rock Paper Scissors matches",
      gameId: "rps",
      target: 2,
      progress: 0,
      bonusXp: 30,
      completedAt: null,
    },
  ],
  sweep: { bonusXp: 30, completedAt: null },
});

/** An achievement as the API lists it; locked unless `unlockedAt` is given. */
export const achievement = (overrides = {}) => ({
  id: "wins-10",
  name: "Rising Star",
  description: "Win 10 matches",
  icon: "star",
  tier: "silver",
  unlockedAt: null,
  progress: { current: 3, target: 10 },
  ...overrides,
});

/** A new player's progress, as GET /api/progress returns it. */
export const PROGRESS = Object.freeze({
  xp: 0,
  level: 1,
  xpIntoLevel: 0,
  xpForNextLevel: 50,
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
});

export const unauthorized = () =>
  new AppRequestError({ code: "UNAUTHORIZED", message: "No active session", status: 401 });

/** A fake API client: every method is a spy with a sensible default; override per test. */
export function fakeApi(overrides = {}) {
  return {
    getGames: vi.fn().mockResolvedValue(GAMES),
    getSession: vi.fn().mockResolvedValue(undefined),
    startGuest: vi.fn().mockResolvedValue(GUEST),
    endSession: vi.fn().mockResolvedValue({}),
    signup: vi.fn(),
    login: vi.fn(),
    changePassword: vi.fn().mockResolvedValue(undefined),
    signOutOtherDevices: vi.fn().mockResolvedValue(undefined),
    getProgress: vi.fn().mockResolvedValue(PROGRESS),
    getMatches: vi.fn(),
    getMatch: vi.fn(),
    getAchievements: vi.fn().mockResolvedValue([]),
    getStreaks: vi.fn().mockResolvedValue(NO_STREAKS),
    getQuests: vi.fn().mockResolvedValue(QUESTS),
    getLeaderboards: vi.fn(),
    getLeaderboard: vi.fn().mockResolvedValue({
      board: { id: "overall", name: "Overall XP", metric: "xp", period: "all", periodId: "all" },
      entries: [],
    }),
    getAdminStatus: vi.fn().mockResolvedValue(false),
    getAnalytics: vi.fn(() => new Promise(() => {})),
    ...overrides,
  };
}

/** A fake socket client recording connect/disconnect and letting tests push server events. */
export function fakeSocket() {
  const handlers = new Map();
  const endedHandlers = new Set();
  let connected = false;
  return {
    connect: vi.fn(() => {
      connected = true;
    }),
    disconnect: vi.fn(() => {
      connected = false;
    }),
    isConnected: () => connected,
    // Like a real request the server has not answered yet; tests override with mockResolvedValue etc.
    request: vi.fn(() => new Promise(() => {})),
    on: vi.fn((event, handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () =>
        handlers.set(
          event,
          (handlers.get(event) ?? []).filter((h) => h !== handler),
        );
    }),
    onEndedByServer: vi.fn((handler) => {
      endedHandlers.add(handler);
      return () => endedHandlers.delete(handler);
    }),
    /** Test helper: simulate a server push. */
    push(event, payload) {
      (handlers.get(event) ?? []).forEach((handler) => handler(payload));
    },
    /** Test helper: the server ends this socket on purpose, as after a sign out elsewhere (CC-234). */
    endByServer() {
      connected = false;
      endedHandlers.forEach((handler) => handler());
    },
  };
}

/**
 * A fake of the message between this browser's tabs (lib/sessionBroadcast.js). `announce` records what this tab
 * told the others, and `receive()` plays a message from another tab (CC-115).
 */
export function fakeSessionBroadcast() {
  const listeners = new Set();
  return {
    announce: vi.fn(),
    onChange: vi.fn((handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    }),
    /** Test helper: another tab of this browser changed who the browser is. */
    receive() {
      listeners.forEach((handler) => handler());
    },
  };
}

/**
 * A fake sound player with the real one's interface (lib/sound/soundPlayer.js). It plays nothing and records
 * what would have played, in order, in `played`, so tests can listen to a page.
 *
 * @param {{ muted?: boolean, volume?: number }} [initial]
 */
export function fakeSound({ muted = false, volume = 0.6 } = {}) {
  let settings = Object.freeze({ muted, volume });
  const listeners = new Set();
  const played = [];
  const update = (next) => {
    settings = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  return {
    played,
    settings: () => settings,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMuted: vi.fn((value) => update({ ...settings, muted: value })),
    setVolume: vi.fn((value) => update({ ...settings, volume: value })),
    unlock: vi.fn(),
    play: vi.fn((names) => {
      played.push(...(typeof names === "string" ? [names] : names));
      return true;
    }),
    listen: vi.fn(() => () => undefined),
  };
}
