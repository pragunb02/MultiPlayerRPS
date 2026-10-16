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

export const unauthorized = () =>
  new AppRequestError({ code: "UNAUTHORIZED", message: "No active session", status: 401 });

/** A fake API client: every method is a spy with a sensible default; override per test. */
export function fakeApi(overrides = {}) {
  return {
    getGames: vi.fn().mockResolvedValue(GAMES),
    getSession: vi.fn().mockRejectedValue(unauthorized()),
    startGuest: vi.fn().mockResolvedValue(GUEST),
    endSession: vi.fn().mockResolvedValue({}),
    signup: vi.fn(),
    login: vi.fn(),
    getProgress: vi.fn(),
    getMatches: vi.fn(),
    getMatch: vi.fn(),
    ...overrides,
  };
}

/** A fake socket client recording connect/disconnect and letting tests push server events. */
export function fakeSocket() {
  const handlers = new Map();
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
    /** Test helper: simulate a server push. */
    push(event, payload) {
      (handlers.get(event) ?? []).forEach((handler) => handler(payload));
    },
  };
}
