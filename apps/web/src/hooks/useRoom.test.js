import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ServicesProvider } from "../app/ServicesProvider.jsx";
import { fakeSocket } from "../testing/fakes.js";
import { newerRoom, useRoom } from "./useRoom.js";

const view = (revision, overrides = {}) => ({ code: "AB2CD3", revision, status: "playing", ...overrides });

describe("newerRoom", () => {
  it("keeps the view with the higher revision", () => {
    expect(newerRoom(view(6), view(5))).toEqual(view(6));
    expect(newerRoom(view(5), view(6))).toEqual(view(6));
  });

  it("takes the incoming view when the two are equally new, for another room, or without revisions", () => {
    const same = view(6, { status: "finished" });
    expect(newerRoom(view(6), same)).toBe(same);
    expect(newerRoom(view(9), view(1, { code: "ZZ9ZZ9" }))).toEqual(view(1, { code: "ZZ9ZZ9" }));
    expect(newerRoom(undefined, view(1))).toEqual(view(1));
    expect(newerRoom({ code: "AB2CD3" }, { code: "AB2CD3", status: "x" })).toEqual({
      code: "AB2CD3",
      status: "x",
    });
  });
});

describe("useRoom with a computer player (CC-138)", () => {
  const wrapper = (socket) => (props) =>
    createElement(ServicesProvider, { services: { socket } }, props.children);

  it("keeps the computer's move when the answer to the join arrives after it", async () => {
    const socket = fakeSocket();
    socket.connect();
    let answerJoin;
    socket.request.mockImplementation(() => new Promise((resolve) => (answerJoin = resolve)));
    const { result } = renderHook(() => useRoom("AB2CD3", { enabled: true }), { wrapper: wrapper(socket) });

    act(() => socket.push("room:updated", view(4, { moved: "computer" })));
    await act(async () => answerJoin(view(3)));

    expect(result.current.room).toEqual(view(4, { moved: "computer" }));
  });

  it("keeps the computer's reply when the answer to the move it replies to arrives late", async () => {
    const socket = fakeSocket();
    socket.connect();
    socket.request.mockResolvedValueOnce(view(3));
    const { result } = renderHook(() => useRoom("AB2CD3", { enabled: true }), { wrapper: wrapper(socket) });
    await act(async () => {});
    let answerMove;
    socket.request.mockImplementation(() => new Promise((resolve) => (answerMove = resolve)));

    let moved;
    act(() => {
      moved = result.current.move({ cell: 0 });
    });
    act(() => socket.push("room:updated", view(5, { turn: "yours again" })));
    await act(async () => {
      answerMove(view(4));
      await moved;
    });

    expect(result.current.room).toEqual(view(5, { turn: "yours again" }));
  });
});
