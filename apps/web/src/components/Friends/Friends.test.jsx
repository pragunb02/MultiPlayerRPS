import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FRIEND_LINK_MAKER_NAME, SOCKET_EVENTS } from "@classicade/shared";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { FRIENDS_COPY, linkInviteCopy } from "./friendsCopy.js";

// CC-052: Add friend beside a seat or a past opponent, the toast for a new request, and the words of the friends
// pages.
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const MATCH = {
  matchId: "11111111-2222-4333-8444-555555555555",
  gameId: "rps",
  you: "AAAAAAAAAAAAAAAAAAAAAA",
  outcomeForYou: "win",
  endedAt: Date.UTC(2026, 9, 20),
  players: [
    { playerId: "BBBBBBBBBBBBBBBBBBBBBB", displayName: "Arjun" },
    { playerId: "AAAAAAAAAAAAAAAAAAAAAA", displayName: "Riya" },
    { playerId: "CCCCCCCCCCCCCCCCCCCCCC", displayName: "Pip", computer: true },
    { playerId: "DDDDDDDDDDDDDDDDDDDDDD", displayName: "Deleted player" },
  ],
};

const historyApi = (overrides = {}) =>
  fakeApi({
    getSession: vi.fn(async () => USER),
    getMatches: vi.fn().mockResolvedValue({ matches: [MATCH] }),
    ...overrides,
  });

describe("Add friend in match history (CC-052)", () => {
  it("asks a past opponent by match and seat, never a computer or a deleted player, and says it is sent", async () => {
    const api = historyApi();
    renderApp({ path: "/profile", api });

    const add = await screen.findByRole("button", { name: "Add friend Arjun" });
    expect(screen.queryByRole("button", { name: "Add friend Pip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add friend Deleted player" })).toBeNull();
    await userEvent.click(add);

    expect(api.sendFriendRequest).toHaveBeenCalledWith({ matchId: MATCH.matchId, seat: 0 });
    expect(await screen.findByText("request sent")).toBeVisible();
  });

  it("says friends when the other player had asked first", async () => {
    renderApp({
      path: "/profile",
      api: historyApi({ sendFriendRequest: vi.fn().mockResolvedValue("friends") }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Add friend Arjun" }));

    expect(await screen.findByText("friends")).toBeVisible();
  });

  it("shows the server's refusal under the button", async () => {
    const refused = new AppRequestError({
      code: "CONFLICT",
      message: "You have 10 requests waiting.",
      status: 409,
    });
    renderApp({
      path: "/profile",
      api: historyApi({ sendFriendRequest: vi.fn().mockRejectedValue(refused) }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Add friend Arjun" }));

    expect(await screen.findByText("You have 10 requests waiting.")).toBeVisible();
  });

  it("is not offered to a guest in history, who finds how to save progress on the Friends page", async () => {
    renderApp({ path: "/profile", api: historyApi({ getSession: vi.fn(async () => GUEST) }) });

    expect(await screen.findByRole("list", { name: "Match history" })).toHaveTextContent("Arjun");
    expect(screen.queryByRole("button", { name: "Add friend Arjun" })).toBeNull();
    // In the phone's menu only: a guest's wide row holds Log in and Sign up instead.
    expect(screen.getAllByRole("link", { name: "Friends" }).map((link) => link.getAttribute("href"))).toEqual(
      ["/friends"],
    );
  });
});

describe("the toast for a new friend request (CC-052)", () => {
  it("tells the player on any page who sent it, with the way to see it and a chime", async () => {
    const socket = fakeSocket();
    const { sound } = renderApp({ path: "/", api: fakeApi({ getSession: vi.fn(async () => USER) }), socket });
    await screen.findByRole("heading", { level: 1 });

    act(() =>
      socket.push(SOCKET_EVENTS.FRIEND_REQUESTED, { requestId: "r", displayName: "Arjun", via: "game" }),
    );

    expect(await screen.findByText("Arjun wants to be your friend")).toBeVisible();
    expect(screen.getByRole("link", { name: "See request" })).toHaveAttribute("href", "/friends");
    expect(sound.play).toHaveBeenCalledWith("notify");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Arjun wants to be your friend")).toBeNull();
  });
});

describe("the words of the friends pages (CC-052)", () => {
  const lines = [
    ...Object.values(FRIENDS_COPY),
    linkInviteCopy("Riya"),
    linkInviteCopy(FRIEND_LINK_MAKER_NAME),
  ];

  it('speaks to the player with "tum", never "aap" (owner, 2026-10-20)', () => {
    expect(lines.map((line) => line.hi).filter((line) => /\baap(ka|ke|ki)?\b/i.test(line))).toEqual([]);
    expect(lines.every((line) => line.hi !== "" && line.en !== "")).toBe(true);
  });
});
