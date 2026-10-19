import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { ServicesProvider } from "../../app/ServicesProvider.jsx";
import { fakeSocket } from "../../testing/fakes.js";
import { useRoomRatings } from "./useRoomRatings.js";

const ME = "guest_me";
const THEM = "guest_them";
const rating = (playerId, overrides = {}) => ({
  playerId,
  rating: 1500,
  deviation: 350,
  games: 0,
  provisional: true,
  ...overrides,
});
const room = (overrides = {}) => ({
  code: "AB2CD3",
  status: "playing",
  game: { matchId: "m1" },
  ...overrides,
});

function setup(initialRoom = room()) {
  const socket = fakeSocket();
  const wrapper = ({ children }) => <ServicesProvider services={{ socket }}>{children}</ServicesProvider>;
  const hook = renderHook(({ shown }) => useRoomRatings(shown), {
    wrapper,
    initialProps: { shown: initialRoom },
  });
  return { socket, ...hook };
}

describe("useRoomRatings", () => {
  it("asks for the ratings of the room it shows, by its code only", async () => {
    const socket = fakeSocket();
    socket.request.mockResolvedValue({
      ratings: [rating(ME), rating(THEM, { rating: 1612, games: 12, provisional: false })],
    });
    const wrapper = ({ children }) => <ServicesProvider services={{ socket }}>{children}</ServicesProvider>;

    const { result } = renderHook(() => useRoomRatings(room()), { wrapper });

    await waitFor(() => expect(result.current.get(THEM)?.rating).toBe(1612));
    expect(socket.request).toHaveBeenCalledWith(SOCKET_EVENTS.RATING_ROOM, { code: "AB2CD3" });
    expect(result.current.get(ME)).toEqual(rating(ME));
  });

  it("takes the ratings the room hears after its game was rated", () => {
    const { socket, result } = setup();

    act(() =>
      socket.push(SOCKET_EVENTS.RATING_UPDATED, { matchId: "m1", ratings: [rating(ME, { change: 12 })] }),
    );

    expect(result.current.get(ME).change).toBe(12);
  });

  it("ignores ratings pushed for another game", () => {
    const { socket, result } = setup();

    act(() => socket.push(SOCKET_EVENTS.RATING_UPDATED, { matchId: "m0", ratings: [rating(ME)] }));

    expect(result.current.size).toBe(0);
  });

  it("asks again when the room starts its next game", () => {
    const { socket, rerender } = setup();

    rerender({ shown: room({ game: { matchId: "m2" } }) });

    expect(socket.request).toHaveBeenCalledTimes(2);
  });

  it("keeps the ratings it had when asking fails, so the bar simply shows none", async () => {
    const socket = fakeSocket();
    socket.request.mockRejectedValue(new Error("offline"));
    const wrapper = ({ children }) => <ServicesProvider services={{ socket }}>{children}</ServicesProvider>;

    const { result } = renderHook(() => useRoomRatings(room()), { wrapper });

    await waitFor(() => expect(socket.request).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });

  it("drops an answer that arrives after the room moved to its next game", async () => {
    const socket = fakeSocket();
    let answerFirst;
    socket.request
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockImplementationOnce(() => new Promise(() => {}));
    const wrapper = ({ children }) => <ServicesProvider services={{ socket }}>{children}</ServicesProvider>;
    const { result, rerender } = renderHook(({ shown }) => useRoomRatings(shown), {
      wrapper,
      initialProps: { shown: room() },
    });

    rerender({ shown: room({ game: { matchId: "m2" } }) });
    await act(async () => answerFirst({ ratings: [rating(ME, { change: 5 })] }));

    expect(result.current.size).toBe(0);
  });

  it("sends nothing on a shared screen, where no game is ever counted (ADR-054)", () => {
    const { socket, result } = setup(room({ sharedScreen: true }));

    expect(socket.request).not.toHaveBeenCalled();
    expect(socket.on).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it("asks nothing before the room's first game started", () => {
    const { socket } = setup(room({ status: "waiting", game: undefined }));

    expect(socket.request).not.toHaveBeenCalled();
  });
});
