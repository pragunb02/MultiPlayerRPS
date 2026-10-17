import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, fakeSocket, GUEST } from "../testing/fakes.js";
import { renderApp } from "../testing/render.jsx";

const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const BOB = { playerId: "guest_b", displayName: "Bob", connected: true };
const ME = { playerId: GUEST.id, displayName: GUEST.displayName, connected: true };

/** Every button and link on the page that has no stable control name. */
const unnamed = () =>
  [...document.querySelectorAll("button, a[href]")]
    .filter((element) => !element.hasAttribute("data-cc-control"))
    .map((element) => element.outerHTML.slice(0, 120));

const roomSocket = (view) => {
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event) => (event === "room:join" ? view : new Promise(() => {})));
  return socket;
};
const tictactoe = (overrides) => ({
  code: "AB2CD3",
  gameId: "tictactoe",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [ME, BOB],
  you: GUEST.id,
  serverTime: Date.now(),
  ...overrides,
});
const tttGame = (outcome) => ({
  view: {
    board: ["X", "", "", "", "O", "", "", "", ""],
    marks: { [GUEST.id]: "X", guest_b: "O" },
    turn: GUEST.id,
    winningLine: [],
  },
  activePlayers: outcome.status === "ongoing" ? [GUEST.id] : [],
  outcome,
});

/**
 * Every control in the app carries a `data-cc-control` name, so the browser tests can press each one and the
 * telemetry can count it (CC-164, CC-170). This walks the main screens and states.
 */
describe("every control has a stable name (CC-164)", () => {
  it.each([
    ["home for a visitor", "/", fakeApi()],
    ["home for a guest", "/", fakeApi({ getSession: async () => GUEST })],
    ["a lobby", "/games/chess", fakeApi()],
    ["log in", "/login", fakeApi()],
    ["sign up", "/signup", fakeApi()],
    ["privacy", "/privacy", fakeApi()],
    ["terms", "/terms", fakeApi()],
    ["not found", "/nowhere", fakeApi()],
    ["leaderboards", "/leaderboards", fakeApi({ getSession: async () => GUEST })],
    [
      "a profile",
      "/profile",
      fakeApi({ getSession: async () => USER, getMatches: async () => ({ matches: [] }) }),
    ],
    ["an invite for a visitor", "/games/chess/rooms/AB2CD3", fakeApi()],
  ])("on %s", async (_name, path, api) => {
    renderApp({ path, api });

    await screen.findAllByRole("link", { name: /ClassiCade home/ });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unnamed()).toEqual([]);
  });

  it.each([
    ["waiting", tictactoe({ status: "waiting", seats: [ME] })],
    ["playing", tictactoe({ status: "playing", game: tttGame({ status: "ongoing" }) })],
    [
      "finished",
      tictactoe({
        status: "finished",
        game: tttGame({ status: "finished", result: "win", winners: [GUEST.id], reason: "three-in-a-row" }),
        rematch: { requestedBy: ["guest_b"], available: true, until: Date.now() + 60_000, declinedBy: "" },
      }),
    ],
  ])("in a room while %s", async (_name, view) => {
    renderApp({
      path: "/games/tic-tac-toe/rooms/AB2CD3",
      socket: roomSocket(view),
      api: fakeApi({ getSession: async () => GUEST }),
    });

    await screen.findByRole("button", { name: "Leave room" });
    if (view.game !== undefined) {
      await screen.findByRole("grid", { name: "Tic-Tac-Toe board" }, { timeout: 10_000 });
    }

    expect(unnamed()).toEqual([]);
  });
});
