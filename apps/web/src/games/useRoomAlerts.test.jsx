import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServicesContext } from "../app/servicesContext.js";
import { fakeSound } from "../testing/fakes.js";
import { useRoomAlerts } from "./useRoomAlerts.js";

// The page level tests reach these paths only on some runs, so the hook is checked here on its own as well.

const ME = "guest_me";
const BOB = "guest_bob";
const seats = [
  { playerId: ME, displayName: "Me", connected: true, presence: "here" },
  { playerId: BOB, displayName: "Bob", connected: true, presence: "here" },
];
const view = (overrides = {}) => ({
  code: "AB2CD3",
  gameId: "ludo",
  status: "finished",
  you: ME,
  seats,
  requests: [],
  rematch: { available: true },
  game: {
    view: {},
    activePlayers: [],
    outcome: { status: "finished", result: "draw", winners: [] },
    number: 1,
  },
  ...overrides,
});

function alerts(first) {
  const notify = vi.fn(() => 7);
  const dismiss = vi.fn();
  const services = { sound: fakeSound() };
  const hook = renderHook(({ room }) => useRoomAlerts(room, { notify, dismiss }), {
    initialProps: { room: first },
    wrapper: ({ children }) => (
      <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
    ),
  });
  return { ...hook, notify, dismiss };
}

describe("useRoomAlerts", () => {
  it("says who left, and takes the message away once a new game starts in the room", () => {
    const { rerender, notify, dismiss } = alerts(view());

    rerender({ room: view({ rematch: { available: false, leftName: "Bob" } }) });
    expect(notify).toHaveBeenCalledWith("Bob left the room");

    rerender({
      room: view({
        status: "playing",
        game: { view: {}, activePlayers: [ME], outcome: { status: "ongoing" }, number: 2 },
      }),
    });
    expect(dismiss).toHaveBeenCalledWith(7);
  });

  it("treats the first view as the starting point, so a reload is not news", () => {
    const { notify } = alerts(view({ rematch: { available: false, leftName: "Bob" } }));

    expect(notify).not.toHaveBeenCalled();
  });
});
