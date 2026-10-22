import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, fakeSocket, fakeSound, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// The player's own connection (CC-158): "Connection lost. Reconnecting…" after a second without one, "Server
// restarting, your game is safe" at once after the server said so, and nothing for a disconnect made on purpose.

function open() {
  const socket = fakeSocket();
  socket.connect();
  const sound = fakeSound();
  renderApp({ socket, sound, api: fakeApi({ getSession: async () => GUEST }) });
  const drop = (reason = "transport close") => act(() => socket.push("disconnect", reason));
  const back = () => act(() => socket.push("connect"));
  return { socket, sound, drop, back };
}

const banner = () => screen.queryByRole("alert");

describe("ConnectionBanner (CC-158)", () => {
  afterEach(() => vi.useRealTimers());

  it("says Reconnecting once the connection has been gone for a second, and goes when it is back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { drop, back, sound } = open();
    await screen.findByText(GUEST.displayName);

    drop();
    act(() => vi.advanceTimersByTime(999));
    expect(banner()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(banner()).toHaveTextContent("Connection lost. Reconnecting… Your game is kept.");
    expect(sound.played).toEqual(["connection"]);

    back();
    expect(banner()).toBeNull();
  });

  it("waits its own second for the next drop", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { drop, back } = open();
    await screen.findByText(GUEST.displayName);
    drop();
    act(() => vi.advanceTimersByTime(1_000));
    back();

    drop();

    expect(banner()).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(banner()).toHaveTextContent("Connection lost. Reconnecting… Your game is kept.");
  });

  it("shows nothing for a drop shorter than a second", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { drop, back } = open();
    await screen.findByText(GUEST.displayName);

    drop();
    act(() => vi.advanceTimersByTime(500));
    back();
    act(() => vi.advanceTimersByTime(1_000));

    expect(banner()).toBeNull();
  });

  it("says at once that the game is safe when the server restarts", async () => {
    const { socket, drop, back } = open();
    await screen.findByText(GUEST.displayName);

    act(() => socket.push("server:restarting", {}));
    expect(banner()).toHaveTextContent("Server restarting, your game is safe");
    drop();
    expect(banner()).toHaveTextContent("Server restarting, your game is safe");

    back();
    expect(banner()).toBeNull();
  });

  it.each(["io client disconnect", "io server disconnect"])(
    "says nothing when the connection was closed on purpose (%s)",
    async (reason) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { drop } = open();
      await screen.findByText(GUEST.displayName);

      drop(reason);
      act(() => vi.advanceTimersByTime(2_000));

      expect(banner()).toBeNull();
    },
  );
});
