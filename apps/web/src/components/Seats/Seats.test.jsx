import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { fakeSound } from "../../testing/fakes.js";
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

function mount(view, sound = fakeSound()) {
  const ui = (next) => (
    <ServicesProvider services={{ sound }}>
      <Seats room={next} />
    </ServicesProvider>
  );
  const result = render(ui(view));
  return { ...result, sound, update: (next) => result.rerender(ui(next)) };
}

const chips = () => screen.getAllByRole("listitem").map((item) => item.textContent);

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
