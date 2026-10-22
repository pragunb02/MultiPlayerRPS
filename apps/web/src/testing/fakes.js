import { vi } from "vitest";
import { AppRequestError } from "../lib/errors.js";
import { DEFAULT_SOUND_SETTINGS } from "../lib/sound/soundPreferences.js";

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

/** A new player's own profile, as GET /api/profile returns it (CC-034): no avatar yet, private. */
export const OWN_PROFILE = Object.freeze({
  handle: "k3m9q2x7p4w8z1ab",
  visibility: "private",
  canBePublic: false,
});

/** An account's friends view with nobody in it yet, as GET /api/friends returns it (CC-052). */
export const NO_FRIENDS = Object.freeze({
  friends: [],
  incoming: [],
  outgoing: [],
  settings: { appearOffline: false },
  safetyTips: true,
});

/** The safety flags of a player who is not surely an adult (GET /api/safety, CC-152). */
export const MINOR_SAFETY = Object.freeze({
  canFollow: false,
  friendsMode: "mutual-known",
  emotes: "off",
  quietHours: Object.freeze({ timeZone: "Asia/Kolkata", from: "22:00", to: "07:00" }),
  shareCardName: false,
  maxOwnedCircleSize: 10,
  publicProfile: false,
  boardName: "hidden",
});

/** An adult account's safety flags. */
export const ADULT_SAFETY = Object.freeze({
  canFollow: true,
  friendsMode: "mutual",
  emotes: "on",
  quietHours: null,
  shareCardName: true,
  maxOwnedCircleSize: 50,
  publicProfile: true,
  boardName: "own",
});

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
    getAccount: vi.fn().mockResolvedValue({ username: "Riya", createdAt: 0, ageGroup: "unknown" }),
    setBirthYear: vi.fn(),
    // A minor's flags, as an account of unknown age gets them (CC-152). Tests of an adult give their own.
    getSafety: vi.fn().mockResolvedValue(MINOR_SAFETY),
    correctBirthYear: vi.fn(),
    exportData: vi.fn(),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    getBlocks: vi.fn().mockResolvedValue([]),
    getChallenges: vi.fn().mockResolvedValue([]),
    getChallenge: vi.fn(),
    createChallenge: vi.fn(),
    acceptChallenge: vi.fn(),
    declineChallenge: vi.fn(),
    withdrawChallenge: vi.fn(),
    challengeLater: vi.fn().mockResolvedValue({}),
    blockPlayer: vi.fn(),
    reportPlayer: vi.fn(),
    getReportQueue: vi.fn(() => new Promise(() => {})),
    actOnReports: vi.fn(),
    suspendAccount: vi.fn(),
    getSuspensionHistory: vi.fn().mockResolvedValue([]),
    getCurrentSuspensions: vi.fn().mockResolvedValue([]),
    liftSuspension: vi.fn(),
    exportSuspendedData: vi.fn(),
    unblockPlayer: vi.fn().mockResolvedValue(undefined),
    // An empty friends view, so a page that shows friends draws instead of failing on a missing answer (CC-052).
    getFriends: vi.fn().mockResolvedValue(NO_FRIENDS),
    sendFriendRequest: vi.fn().mockResolvedValue("sent"),
    answerFriendRequest: vi.fn().mockResolvedValue("friends"),
    cancelFriendRequest: vi.fn().mockResolvedValue(undefined),
    removeFriend: vi.fn().mockResolvedValue(undefined),
    setAppearOffline: vi.fn(async (appearOffline) => ({ appearOffline })),
    makeFriendLink: vi.fn().mockResolvedValue({ token: "AbCdEfGhIjKlMnOpQrSt_-", expiresAt: 0 }),
    getFriendLink: vi.fn(() => new Promise(() => {})),
    useFriendLink: vi.fn().mockResolvedValue("sent"),
    getOwnProfile: vi.fn().mockResolvedValue(OWN_PROFILE),
    setAvatar: vi.fn(async (avatar) => ({ ...OWN_PROFILE, avatar })),
    setProfileVisibility: vi.fn(async (visibility) => ({ ...OWN_PROFILE, visibility })),
    getPlayerProfile: vi.fn(() => new Promise(() => {})),
    getProgress: vi.fn().mockResolvedValue(PROGRESS),
    // An empty history, so a page that lists matches draws instead of failing on a missing answer (CC-288).
    getMatches: vi.fn().mockResolvedValue({ matches: [] }),
    getMatch: vi.fn(),
    getAchievements: vi.fn().mockResolvedValue([]),
    getStreaks: vi.fn().mockResolvedValue(NO_STREAKS),
    getQuests: vi.fn().mockResolvedValue(QUESTS),
    // Like a puzzle the server has not sent yet. Tests of the daily puzzle page give their own (CC-144).
    getDailyPuzzle: vi.fn(() => new Promise(() => {})),
    playDailyMove: vi.fn(),
    takeDailyHint: vi.fn(),
    getLeaderboards: vi.fn(),
    getLeaderboard: vi.fn().mockResolvedValue({
      board: { id: "overall", name: "Overall XP", metric: "xp", period: "all", periodId: "all" },
      entries: [],
    }),
    getAdminStatus: vi.fn().mockResolvedValue(false),
    getAnalytics: vi.fn(() => new Promise(() => {})),
    sendFeedback: vi.fn(),
    getFeedbackForm: vi.fn().mockResolvedValue({ replyEmail: false }),
    getFeedbackInbox: vi.fn(() => new Promise(() => {})),
    setFeedbackStatus: vi.fn(),
    getFeedbackItem: vi.fn(),
    deleteFeedback: vi.fn().mockResolvedValue(undefined),
    getFlags: vi.fn(async (names) => Object.fromEntries(names.map((name) => [name, false]))),
    sendFlagSuccess: vi.fn().mockResolvedValue(undefined),
    getAdminFlags: vi.fn(() => new Promise(() => {})),
    setFlagRollout: vi.fn(),
    clearFlagRollout: vi.fn(),
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
    // The real client downloads Socket.IO when this is called (CC-333). The fake has nothing to download.
    needNow: vi.fn(),
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
export function fakeSound({
  muted = false,
  volume = 0.6,
  categories = DEFAULT_SOUND_SETTINGS.categories,
} = {}) {
  let settings = Object.freeze({ muted, volume, categories });
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
    setCategory: vi.fn((id, change) =>
      update({
        ...settings,
        categories: { ...settings.categories, [id]: { ...settings.categories[id], ...change } },
      }),
    ),
    unlock: vi.fn(),
    play: vi.fn((names) => {
      played.push(...(typeof names === "string" ? [names] : names));
      return true;
    }),
    listen: vi.fn(() => () => undefined),
  };
}

/** A fake of the file saver (lib/download.js): it records what would have been saved, in `saved`. */
export function fakeDownload() {
  const saved = [];
  return {
    saved,
    saveJson: vi.fn((file) => {
      saved.push(file);
    }),
  };
}
