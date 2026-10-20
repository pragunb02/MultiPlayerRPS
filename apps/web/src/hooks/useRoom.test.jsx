import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { describe, expect, it } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { ServicesProvider } from "../app/ServicesProvider.jsx";
import { fakeSocket, GUEST } from "../testing/fakes.js";
import { useRoom } from "./useRoom.js";

const CODE = "AB2CD3";
const view = (overrides = {}) => ({
  code: CODE,
  gameId: "tictactoe",
  status: "waiting",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [{ playerId: GUEST.id, displayName: GUEST.displayName, connected: true }],
  you: GUEST.id,
  ...overrides,
});

/**
 * The hook for room AB2CD3 over a connected fake socket that answers the join with `joined`. `goingTo` is the
 * page the browser shows when the room page goes away.
 */
async function openRoom({ joined = view(), goingTo = "/games/tic-tac-toe" } = {}) {
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event) => (event === SOCKET_EVENTS.ROOM_JOIN ? joined : {}));
  const wrapper = ({ children }) => <ServicesProvider services={{ socket }}>{children}</ServicesProvider>;
  const hook = renderHook(() => useRoom(CODE, { enabled: true, currentPath: () => goingTo }), { wrapper });
  await waitFor(() => expect(hook.result.current.status).toBe("ready"));
  return { ...hook, socket };
}

const leaves = (socket) => socket.request.mock.calls.filter(([event]) => event === SOCKET_EVENTS.ROOM_LEAVE);

describe("useRoom: leaving the page (CC-112)", () => {
  it("leaves a waiting room when the room page goes away", async () => {
    const { socket, unmount } = await openRoom();

    unmount();

    // Only while it still waits: a game that started a moment ago is never forfeited by closing the page.
    expect(leaves(socket)).toEqual([[SOCKET_EVENTS.ROOM_LEAVE, { code: CODE, waitingOnly: true }]]);
  });

  it("keeps the seat on the way to sign up and back to this room", async () => {
    const { socket, unmount } = await openRoom({
      goingTo: `/signup?next=%2Fgames%2Ftic-tac-toe%2Frooms%2F${CODE}`,
    });

    unmount();

    expect(leaves(socket)).toEqual([]);
  });

  it("keeps the seat in a game that has started", async () => {
    const { socket, unmount } = await openRoom({ joined: view({ status: "playing" }) });

    unmount();

    expect(leaves(socket)).toEqual([]);
  });

  it("follows pushed changes: a waiting room that started is not left", async () => {
    const { socket, unmount } = await openRoom();
    act(() => socket.push(SOCKET_EVENTS.ROOM_UPDATED, view({ status: "playing" })));

    unmount();

    expect(leaves(socket)).toEqual([]);
  });

  it("leaves nothing for a viewer without a seat", async () => {
    const { socket, unmount } = await openRoom({ joined: view({ you: "" }) });

    unmount();

    expect(leaves(socket)).toEqual([]);
  });

  it("does not leave twice after the player already left", async () => {
    const { socket, result, unmount } = await openRoom();
    await act(() => result.current.leave());

    unmount();

    expect(leaves(socket)).toHaveLength(1);
  });

  it("ignores a refused leave, because nobody waits for its answer", async () => {
    const { socket, unmount } = await openRoom();
    socket.request.mockImplementation(async () => {
      throw new Error("You are not in this room");
    });

    unmount();

    await waitFor(() => expect(leaves(socket)).toHaveLength(1));
  });
});

const departures = (socket) =>
  socket.request.mock.calls.filter(
    ([event]) => event === SOCKET_EVENTS.ROOM_LEAVE || event === SOCKET_EVENTS.ROOM_AWAY,
  );

describe("useRoom: Leave pressed in the step that draws the room (CC-288)", () => {
  // The press comes before any plain effect of that step has run. A seat copied in a plain effect came back after
  // Leave gave it up, and leaving the page then told the server the player was away.
  function LeaveOnDraw() {
    const room = useRoom(CODE, { enabled: true, currentPath: () => "/games/tic-tac-toe" });
    const pressed = useRef(false);
    useLayoutEffect(() => {
      if (room.status === "ready" && !pressed.current) {
        pressed.current = true;
        room.leave();
      }
    });
    return <p>{room.status}</p>;
  }

  it("stays left: leaving the page afterwards sends nothing more", async () => {
    const socket = fakeSocket();
    socket.connect();
    socket.request.mockImplementation(async (event) =>
      event === SOCKET_EVENTS.ROOM_JOIN ? view({ status: "playing" }) : {},
    );
    const { unmount } = render(
      <ServicesProvider services={{ socket }}>
        <LeaveOnDraw />
      </ServicesProvider>,
    );
    await screen.findByText("ready");

    unmount();

    expect(socket.request).not.toHaveBeenCalledWith(SOCKET_EVENTS.ROOM_AWAY, expect.anything());
    expect(leaves(socket)).toEqual([[SOCKET_EVENTS.ROOM_LEAVE, { code: CODE }]]);
  });
});

describe("useRoom: leaving the page leaves a waiting room, and is away from any other (CC-112, CC-207)", () => {
  it("only leaves a waiting room, without saying away as well", async () => {
    const { socket, unmount } = await openRoom();

    unmount();

    expect(departures(socket)).toEqual([[SOCKET_EVENTS.ROOM_LEAVE, { code: CODE, waitingOnly: true }]]);
  });

  it.each(["playing", "finished"])("is away from a %s room, and keeps the seat", async (status) => {
    const { socket, unmount } = await openRoom({ joined: view({ status }) });

    unmount();

    expect(departures(socket)).toEqual([[SOCKET_EVENTS.ROOM_AWAY, { code: CODE }]]);
  });

  it("is away from a waiting room while signing up on the way back to it", async () => {
    const { socket, unmount } = await openRoom({
      goingTo: `/signup?next=%2Fgames%2Ftic-tac-toe%2Frooms%2F${CODE}`,
    });

    unmount();

    expect(departures(socket)).toEqual([[SOCKET_EVENTS.ROOM_AWAY, { code: CODE }]]);
  });

  it("follows pushed changes: a waiting room whose game started is away, not left", async () => {
    const { socket, unmount } = await openRoom();
    act(() => socket.push(SOCKET_EVENTS.ROOM_UPDATED, view({ status: "playing" })));

    unmount();

    expect(departures(socket)).toEqual([[SOCKET_EVENTS.ROOM_AWAY, { code: CODE }]]);
  });

  it("says nothing for a viewer without a seat, or after the player left", async () => {
    const watching = await openRoom({ joined: view({ you: "", status: "playing" }) });
    watching.unmount();
    const leaving = await openRoom({ joined: view({ status: "playing" }) });
    await act(() => leaving.result.current.leave());
    leaving.unmount();

    expect(departures(watching.socket)).toEqual([]);
    expect(departures(leaving.socket)).toEqual([[SOCKET_EVENTS.ROOM_LEAVE, { code: CODE }]]);
  });
});
