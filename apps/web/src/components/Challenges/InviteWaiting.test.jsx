import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { INVITE_KEEP_AFTER_MS, SOCKET_EVENTS } from "@classicade/shared";
import { fakeApi, fakeSocket } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { renderApp } from "../../testing/render.jsx";
import { INVITE_COPY } from "../Friends/inviteCopy.js";

// CC-052 scenario 4: Arjun took Riya's invite, and the room made for both waits for Riya, who is not on its page.
// Arjun reads that Riya was told. After 5 minutes he may keep the invite for later, or play Pip meanwhile: either
// sends the game back to Riya as his own invite and gives up his seat here.
const ARJUN = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Arjun" };
const RIYA_SEAT = { playerId: "seatRiya", displayName: "Riya", connected: false, presence: "offline" };
const ME = { playerId: "seatMe", displayName: "Arjun", connected: true, presence: "here" };
const ROOM = Object.freeze({
  code: "AB2CD3",
  gameId: "chess",
  status: "waiting",
  hostId: "seatRiya",
  players: { min: 2, max: 2 },
  seats: [RIYA_SEAT, ME],
  you: "seatMe",
});
const taken = (acceptedAt) => ({
  id: "c0000000000000000001",
  gameId: "chess",
  options: {},
  fromName: "Riya",
  own: false,
  forYou: true,
  took: true,
  later: false,
  toOne: true,
  state: "accepted",
  room: { code: "AB2CD3", gameId: "chess" },
  acceptedAt,
  until: acceptedAt + 30 * 60 * 1000,
});

function openRoom({ on = true, acceptedAt = Date.now(), joined = ROOM, api: overrides = {} } = {}) {
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event) => {
    if (event === SOCKET_EVENTS.ROOM_JOIN) return joined;
    if (event === SOCKET_EVENTS.ROOM_PLAY_COMPUTER) return { code: "PIP123" };
    return { left: true };
  });
  const api = fakeApi({
    getSession: async () => ARJUN,
    getChallenges: vi.fn().mockResolvedValue([taken(acceptedAt)]),
    getFlags: vi.fn(async (names) => Object.fromEntries(names.map((name) => [name, on]))),
    inviteAgain: vi.fn().mockResolvedValue({ id: "c0000000000000000002", state: "open", own: true }),
    ...overrides,
  });
  return { ...renderApp({ path: "/games/chess/rooms/AB2CD3", socket, api }), socket, api };
}

describe("waiting in the room of an invite (CC-052 scenario 4)", () => {
  flagPaths("friend_invites", (on) => {
    it("tells the taker the sender was told, and offers keep for later after 5 minutes", async () => {
      const { api, socket, url } = openRoom({ on, acceptedAt: Date.now() - INVITE_KEEP_AFTER_MS + 300 });

      expect(await screen.findByRole("heading", { name: "Waiting for Riya" })).toBeInTheDocument();
      expect(screen.getByText(INVITE_COPY.isntHere("Riya").en)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Keep it for later" })).toBeNull();
      if (!on) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(screen.queryByRole("button", { name: "Keep it for later" })).toBeNull();
        return;
      }

      await userEvent.click(
        await screen.findByRole("button", { name: "Keep it for later" }, { timeout: 2_000 }),
      );

      expect(api.inviteAgain).toHaveBeenCalledWith("c0000000000000000001");
      await waitFor(() => expect(url()).toBe("/friends"));
      expect(socket.request).toHaveBeenCalledWith(
        SOCKET_EVENTS.ROOM_LEAVE,
        expect.objectContaining({ code: "AB2CD3" }),
      );
    });

    it("plays Pip meanwhile, after sending the invite back", async () => {
      const { api, url } = openRoom({ on, acceptedAt: Date.now() - INVITE_KEEP_AFTER_MS - 1000 });

      await screen.findByRole("heading", { name: "Waiting for Riya" });
      if (!on) {
        expect(screen.queryByRole("button", { name: "Play Pip meanwhile" })).toBeNull();
        return;
      }
      await userEvent.click(await screen.findByRole("button", { name: "Play Pip meanwhile" }));

      expect(api.inviteAgain).toHaveBeenCalledWith("c0000000000000000001");
      await waitFor(() => expect(url()).toBe("/games/tic-tac-toe/rooms/PIP123"));
    });
  });

  it("says the sender was told while they are away on another page of the site too", async () => {
    openRoom({ joined: { ...ROOM, seats: [{ ...RIYA_SEAT, connected: false, presence: "away" }, ME] } });
    expect(await screen.findByText(INVITE_COPY.isntHere("Riya").en)).toBeInTheDocument();
  });

  it("leaves a room no invite of this player made as it was", async () => {
    openRoom({ api: { getChallenges: vi.fn().mockResolvedValue([]) } });

    expect(
      await screen.findByText("Riya is away. The game starts as soon as they are back."),
    ).toBeInTheDocument();
    expect(screen.queryByText(INVITE_COPY.isntHere("Riya").en)).toBeNull();
  });
});
