import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { AppRequestError } from "../../lib/errors.js";
import { SessionContext } from "../../hooks/useSession.js";
import { fakeApi, fakeSound, GUEST } from "../../testing/fakes.js";
import { ToastContext } from "../Toast/toastContext.js";
import { Seats } from "./Seats.jsx";

const T = 9_000_000;
const seat = (overrides) => ({
  playerId: "guest_a",
  displayName: "Alice",
  connected: true,
  presence: "here",
  since: T,
  graceUntil: 0,
  ...overrides,
});
const ALICE = seat();
const BOB = seat({ playerId: "guest_b", displayName: "Bob" });

const room = (overrides = {}) => ({
  hostId: "guest_a",
  you: "guest_b",
  players: { min: 2, max: 2 },
  status: "playing",
  serverTime: T,
  seats: [ALICE, BOB],
  game: { activePlayers: [], turnEndsAt: 0, outcome: { status: "ongoing" } },
  ...overrides,
});

const ACCOUNT = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Bob" };

function mount(view, sound = fakeSound(), api = fakeApi(), identity = ACCOUNT) {
  const toast = { show: vi.fn(), dismiss: vi.fn(), hold: vi.fn(() => () => undefined) };
  const ui = (next) => (
    <ServicesProvider services={{ sound, api }}>
      <SessionContext.Provider value={{ status: "ready", identity }}>
        <ToastContext.Provider value={toast}>
          <Seats room={next} />
        </ToastContext.Provider>
      </SessionContext.Provider>
    </ServicesProvider>
  );
  const result = render(ui(view));
  return { ...result, sound, api, toast, update: (next) => result.rerender(ui(next)) };
}

// The Add friend, Block and Report buttons at the end of another player's row have tests of their own (CC-044,
// CC-052).
const chips = () =>
  screen
    .getAllByRole("listitem")
    .map((item) => item.textContent.replace(/Add friend[\s\S]*$/, "").replace(/(Block)?(Report)?$/, ""));

describe("Seats (CC-158)", () => {
  afterEach(() => vi.useRealTimers());

  it("lists players with you and host tags, where each is, and open seats", () => {
    mount(room({ players: { min: 2, max: 3 } }));

    expect(chips()).toEqual(["Alicehostconnected", "Bobyouconnected", "Waiting for a player…"]);
  });

  it("shows who is thinking, with the time left to move", () => {
    vi.useFakeTimers({ now: 0 });
    mount(room({ game: { activePlayers: ["guest_a"], turnEndsAt: T + 24_000, outcome: {} } }));

    expect(chips()[0]).toBe("Alicehostthinking 0:24");
    act(() => vi.advanceTimersByTime(1_000));
    expect(chips()[0]).toBe("Alicehostthinking 0:23");
  });

  it("shows thinking without a timer in a game with its own clock", () => {
    mount(room({ game: { activePlayers: ["guest_a"], turnEndsAt: 0, outcome: {} } }));

    expect(chips()[0]).toBe("Alicehostthinking ");
  });

  it("shows a player away from the game screen", () => {
    mount(room({ seats: [seat({ connected: false, presence: "away" }), BOB] }));

    expect(chips()[0]).toBe("Alicehostaway from the game screen");
  });

  it("counts down an offline player's grace period, then shows them offline", () => {
    vi.useFakeTimers({ now: 0 });
    mount(room({ seats: [seat({ connected: false, presence: "offline", graceUntil: T + 2_000 }), BOB] }));

    expect(chips()[0]).toBe("Alicehostreconnecting 0:02");
    act(() => vi.advanceTimersByTime(2_000));
    expect(chips()[0]).toBe("Alicehostoffline");
  });

  it("shows a player who forfeited a finished game as left", () => {
    const forfeit = { status: "finished", result: "win", winners: ["guest_b"], reason: "forfeit" };

    mount(room({ status: "finished", game: { activePlayers: [], turnEndsAt: 0, outcome: forfeit } }));

    expect(chips()).toEqual(["Alicehostleft", "Bobyouconnected"]);
  });

  it("tells the viewer once a change has settled, with a soft sound, and not on the first view", () => {
    vi.useFakeTimers({ now: 0 });
    const { update, sound } = mount(room());
    const announced = () => screen.getByRole("status").textContent;
    act(() => vi.advanceTimersByTime(2_000));
    expect(announced()).toBe("");

    update(room({ seats: [seat({ connected: false, presence: "away" }), BOB] }));
    act(() => vi.advanceTimersByTime(999));
    expect(announced()).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(announced()).toBe("Alice is away from the game screen");
    expect(sound.played).toEqual(["presence"]);

    update(room({ seats: [seat({ connected: false, presence: "offline" }), BOB] }));
    act(() => vi.advanceTimersByTime(1_000));
    expect(announced()).toBe("Alice lost the connection");
    update(room());
    act(() => vi.advanceTimersByTime(1_000));
    expect(announced()).toBe("Alice is back in the game");
  });

  it("says nothing about a change that did not hold, such as a reload going offline and back", () => {
    vi.useFakeTimers({ now: 0 });
    const { update, sound } = mount(room());

    update(room({ seats: [seat({ connected: false, presence: "offline" }), BOB] }));
    act(() => vi.advanceTimersByTime(500));
    update(room());
    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByRole("status").textContent).toBe("");
    expect(sound.played).toEqual([]);
  });

  it("says nothing about a presence it has no words for", () => {
    vi.useFakeTimers({ now: 0 });
    const { update } = mount(room());

    update(room({ seats: [seat({ presence: "lost-in-space" }), BOB] }));
    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("Seats: blocking from a seat (CC-044)", () => {
  const blockable = (overrides = {}) => room({ code: "ROOM22", ...overrides });
  const blockButton = () => screen.queryByRole("button", { name: "Block Alice" });

  it("offers Block only for other people, and only to a seated viewer", () => {
    const rocky = seat({
      playerId: "bot_rocky_hard",
      displayName: "Rocky",
      bot: { character: "rocky", level: "hard" },
    });
    // Seats are named by opaque seat ids (CC-253), so the stand-in is known by its label, not its id.
    const standIn = seat({
      playerId: "seatOfTheStandIn000000",
      displayName: "Deleted player",
      deleted: true,
    });
    const { update } = mount(blockable({ players: { min: 2, max: 4 }, seats: [ALICE, BOB, rocky, standIn] }));

    expect(
      screen.getAllByRole("button", { name: /^Block / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Block Alice"]);
    expect(blockButton()).toHaveAttribute("data-cc-control", "room.seat.block");

    update(blockable({ you: "" }));
    expect(blockButton()).toBeNull();
  });

  it("asks first, and Cancel blocks nobody", async () => {
    const { api } = mount(blockable());

    await userEvent.click(blockButton());
    const dialog = screen.getByRole("dialog", { name: "Block Alice?" });
    expect(dialog).toHaveTextContent(
      "You won't be put in a room with Alice again, and there are no rematches between you. Alice is not told. You can unblock them on your profile.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(blockButton());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.blockPlayer).not.toHaveBeenCalled();
  });

  it("blocks the seat by its place in the room, says so to the viewer only, and marks the seat", async () => {
    const api = fakeApi({
      blockPlayer: vi.fn().mockResolvedValue({ blockId: "b1", displayName: "Alice", blockedAt: 1 }),
    });
    const { toast } = mount(blockable(), fakeSound(), api);

    await userEvent.click(blockButton());
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));

    expect(api.blockPlayer).toHaveBeenCalledWith({ roomCode: "ROOM22", seat: 0, seatId: "guest_a" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toast.show).toHaveBeenCalledWith("You blocked Alice.", { tone: "info" });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Alicehostconnectedblocked");
    expect(blockButton()).toBeNull();
  });

  it.each([
    ["the seats swap for a rematch", [BOB, ALICE]],
    ["Alice leaves and Carol takes her seat", [seat({ playerId: "guest_c", displayName: "Carol" }), BOB]],
    ["Alice leaves", [BOB]],
  ])("closes the question when %s, so nobody else is ever blocked by it", async (_, seatsNow) => {
    const { api, update } = mount(blockable());
    await userEvent.click(blockButton());
    expect(screen.getByRole("dialog", { name: "Block Alice?" })).toBeVisible();

    update(blockable({ seats: seatsNow }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.blockPlayer).not.toHaveBeenCalled();
  });

  it("keeps the question open while the seats stay as they were, such as a presence change", async () => {
    mount(blockable()).update(
      blockable({ seats: [{ ...ALICE, connected: false, presence: "offline" }, BOB] }),
    );
    await userEvent.click(blockButton());

    expect(screen.getByRole("dialog", { name: "Block Alice?" })).toBeVisible();
  });

  it("shows the server's refusal under the button and keeps the question open", async () => {
    const refusal = new AppRequestError({
      code: "NOT_FOUND",
      message: "You can only block someone you played with",
      status: 404,
    });
    const api = fakeApi({ blockPlayer: vi.fn().mockRejectedValue(refusal) });
    const { toast } = mount(blockable(), fakeSound(), api);

    await userEvent.click(blockButton());
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Block" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You can only block someone you played with");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(toast.show).not.toHaveBeenCalled();
  });
});

describe("Seats: reporting from a seat (CC-044, ADR-071)", () => {
  const reportable = (overrides = {}) => room({ code: "ROOM22", ...overrides });
  const reportButton = () => screen.queryByRole("button", { name: "Report Alice" });

  it("offers Report next to Block, for other people only, and only to a seated viewer", () => {
    const rocky = seat({
      playerId: "bot_rocky_hard",
      displayName: "Rocky",
      bot: { character: "rocky", level: "hard" },
    });
    const { update } = mount(reportable({ players: { min: 2, max: 3 }, seats: [ALICE, BOB, rocky] }));

    expect(
      screen.getAllByRole("button", { name: /^Report / }).map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Report Alice"]);
    expect(reportButton()).toHaveAttribute("data-cc-control", "room.seat.report");

    update(reportable({ you: "" }));
    expect(reportButton()).toBeNull();
  });

  it("reports the seat by its place and the id the page saw there, and offers the one-tap block after", async () => {
    const api = fakeApi({
      reportPlayer: vi.fn().mockResolvedValue({ reportId: "r1", createdAt: 1 }),
      blockPlayer: vi.fn().mockResolvedValue({ blockId: "b1", displayName: "Alice", blockedAt: 1 }),
    });
    mount(reportable(), fakeSound(), api);

    await userEvent.click(reportButton());
    const dialog = screen.getByRole("dialog", { name: /Report Alice/ });
    await userEvent.click(within(dialog).getByRole("radio", { name: /Offensive name/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    await screen.findByRole("dialog", { name: /Thanks, we got it/ });
    await userEvent.click(screen.getByRole("button", { name: "Block Alice too" }));

    expect(api.reportPlayer).toHaveBeenCalledWith({
      roomCode: "ROOM22",
      seat: 0,
      seatId: "guest_a",
      reason: "name",
    });
    expect(api.blockPlayer).toHaveBeenCalledWith({ reportId: "r1" });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("blocked");
  });

  it("sends nothing when the viewer cancels", async () => {
    const { api } = mount(reportable());

    await userEvent.click(reportButton());
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.reportPlayer).not.toHaveBeenCalled();
  });

  it("closes the report when the seats change under it", async () => {
    const { update } = mount(reportable());

    await userEvent.click(reportButton());
    update(reportable({ seats: [BOB, seat({ playerId: "guest_c", displayName: "Carol" })] }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Seats: avatars (CC-034)", () => {
  it("offers an account Add friend beside Block once the game is over, by the seat's place and seat id (CC-052)", async () => {
    const api = fakeApi();
    mount(room({ status: "finished" }), fakeSound(), api, ACCOUNT);

    expect(
      screen.getAllByRole("button", { name: /^Add friend / }).map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Add friend Alice"]);
    await userEvent.click(screen.getByRole("button", { name: "Add friend Alice" }));

    expect(api.sendFriendRequest).toHaveBeenCalledWith({ roomCode: undefined, seat: 0, seatId: "guest_a" });
    expect(await screen.findByText("request sent")).toBeVisible();
  });

  it("offers Add friend to nobody while a game is on, and never to a guest (CC-052)", () => {
    mount(room(), fakeSound(), fakeApi(), ACCOUNT);
    expect(screen.queryByRole("button", { name: /^Add friend / })).toBeNull();
    cleanup();

    mount(room({ status: "finished" }), fakeSound(), fakeApi(), GUEST);
    expect(screen.queryByRole("button", { name: /^Add friend / })).toBeNull();
    expect(screen.getByRole("button", { name: "Block Alice" })).toBeVisible();
  });

  it("draws each person's avatar beside their name, the silhouette for none, and nothing for a computer", () => {
    const pip = seat({ playerId: "seat_c", displayName: "Pip", bot: { character: "pip", level: "easy" } });
    mount(room({ players: { min: 2, max: 3 }, seats: [seat({ avatar: "rocket" }), BOB, pip] }));

    const [alice, bob, computer] = screen.getAllByRole("listitem");

    expect(alice.querySelectorAll("svg")).toHaveLength(1);
    expect(alice.querySelector("svg .silhouette")).toBeNull();
    expect(bob.querySelector("svg .silhouette")).not.toBeNull();
    expect(computer.querySelector("svg")).toBeNull();
    expect(alice.textContent).toContain("Alice");
  });
});
