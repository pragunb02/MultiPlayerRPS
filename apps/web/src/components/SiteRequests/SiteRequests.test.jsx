import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, fakeSound, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { installVisibility } from "../../testing/visibility.js";

// Requests that reach a player on any page (CC-207): the question with Accept and go and Decline, a chime and the
// tab title, and for the asker a toast saying how it ended.

const BOB = "guest_b";
const T = 1_000_000;
const request = (overrides = {}) => ({
  type: "rematch",
  from: BOB,
  to: GUEST.id,
  createdAt: T,
  expiresAt: T + 60_000,
  state: "open",
  endedAt: 0,
  ...overrides,
});
const pushed = (requests, overrides = {}) => ({
  code: "AB2CD3",
  gameId: "chess",
  names: { [GUEST.id]: GUEST.displayName, [BOB]: "Bob" },
  requests,
  serverTime: T,
  ...overrides,
});

async function openHome({ path = "/", answer = async () => ({}) } = {}) {
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event, payload) => {
    if (event === "room:answer") return answer(payload);
    if (event === "room:join") throw new AppRequestError({ code: "NOT_FOUND", message: "Room not found" });
    return {};
  });
  const sound = fakeSound();
  const view = renderApp({ path, socket, sound, api: fakeApi({ getSession: async () => GUEST }) });
  const push = (payload) => act(() => socket.push("request:updated", payload));
  // Requests are shown to the player they are addressed to, so the session must be known first.
  await screen.findByText(GUEST.displayName);
  return { ...view, socket, sound, push };
}

const question = () => screen.queryByRole("region", { name: "Rematch?" });

describe("SiteRequests (CC-207)", () => {
  afterEach(() => vi.useRealTimers());

  it("asks a player on another page, with a chime and an urgent announcement", async () => {
    const { push, sound } = await openHome();
    await screen.findByRole("button", { name: "Sound on" });

    push(pushed([request()]));

    const popup = question();
    expect(popup).toHaveAccessibleDescription("Bob wants a rematch at Chess");
    expect(within(popup).getByRole("alert")).toHaveTextContent("Bob wants a rematch at Chess");
    expect(within(popup).getByText("1:00")).toBeInTheDocument();
    expect(sound.played).toEqual(["notify"]);
    push(pushed([request()]));
    expect(sound.played).toEqual(["notify"]);
  });

  it("accepts and goes to the room on Accept and go", async () => {
    const user = userEvent.setup();
    const { push, socket, url } = await openHome();
    push(pushed([request()]));

    await user.click(within(question()).getByRole("button", { name: "Accept and go" }));

    expect(socket.request).toHaveBeenCalledWith("room:answer", {
      code: "AB2CD3",
      type: "rematch",
      answer: "accept",
    });
    await waitFor(() => expect(url()).toBe("/games/chess/rooms/AB2CD3"));
  });

  it("stays where it is and says why when accepting fails", async () => {
    const user = userEvent.setup();
    const { push, url } = await openHome({
      answer: async () => {
        throw new AppRequestError({ code: "CONFLICT", message: "That request is no longer open" });
      },
    });
    push(pushed([request()]));

    await user.click(within(question()).getByRole("button", { name: "Accept and go" }));

    expect(await screen.findByText("That request is no longer open")).toBeInTheDocument();
    expect(url()).toBe("/");
  });

  it("declines with Decline, and the question goes once the server says so", async () => {
    const user = userEvent.setup();
    const { push, socket } = await openHome();
    push(pushed([request()]));

    await user.click(within(question()).getByRole("button", { name: "Decline" }));
    expect(socket.request).toHaveBeenCalledWith("room:answer", {
      code: "AB2CD3",
      type: "rematch",
      answer: "decline",
    });
    push(pushed([request({ state: "declined", endedAt: T + 1 })]));

    expect(question()).toBeNull();
  });

  it("shows nothing on the room's own page, where the request banner asks instead", async () => {
    const { push } = await openHome({ path: "/games/chess/rooms/AB2CD3" });

    push(pushed([request()]));

    expect(question()).toBeNull();
  });

  it("shows nothing for requests the player asked, or that are not addressed to them", async () => {
    const { push } = await openHome();

    push(pushed([request({ from: GUEST.id, to: BOB }), request({ from: "guest_x", to: "guest_y" })]));

    expect(question()).toBeNull();
  });

  it("words a game's own request, and names an asker it does not know", async () => {
    const { push } = await openHome();

    push(pushed([request({ type: "draw", expiresAt: T + 30_000 })], { names: {} }));

    expect(screen.getByRole("region", { name: "Draw offer" })).toHaveAccessibleDescription(
      "Someone offers a draw at Chess",
    );
  });

  it("names a game the app does not know as a game", async () => {
    const { push } = await openHome();

    push(pushed([request()], { gameId: "ludo" }));

    expect(question()).toHaveAccessibleDescription("Bob wants a rematch at a game");
  });

  it("calls the player back to a background tab", async () => {
    const tab = installVisibility({ hidden: true });
    const { push } = await openHome();
    await screen.findByRole("button", { name: "Sound on" });

    push(pushed([request()]));

    expect(document.title).toBe("Rematch? · ClassiCade");
    act(() => tab.setHidden(false));
    expect(document.title).not.toBe("Rematch? · ClassiCade");
  });

  it("tells the asker on another page how their request ended", async () => {
    const mine = request({ from: GUEST.id, to: BOB });
    const { push } = await openHome();
    push(pushed([mine]));

    push(pushed([{ ...mine, state: "accepted", endedAt: T + 1 }]));
    expect(await screen.findByText("Bob accepted. Starting the next game")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the game" })).toHaveAttribute(
      "href",
      "/games/chess/rooms/AB2CD3",
    );

    push(pushed([{ ...mine, createdAt: T + 2 }]));
    push(pushed([{ ...mine, createdAt: T + 2, state: "declined", endedAt: T + 3 }]));
    expect(await screen.findByText("Bob declined the rematch")).toBeInTheDocument();

    push(pushed([{ ...mine, createdAt: T + 4 }]));
    push(pushed([{ ...mine, createdAt: T + 4, state: "expired", endedAt: T + 5 }]));
    expect(await screen.findByText("No answer from Bob")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the room" })).toBeInTheDocument();
  });

  it("says nothing about the asker's own withdrawal, and names an opponent it does not know", async () => {
    const mine = request({ from: GUEST.id, to: BOB });
    const { push } = await openHome();
    push(pushed([mine], { names: {} }));

    push(pushed([{ ...mine, state: "withdrawn", endedAt: T + 1 }], { names: {} }));
    push(pushed([{ ...mine, createdAt: T + 2 }], { names: {} }));
    push(pushed([{ ...mine, createdAt: T + 2, state: "declined", endedAt: T + 3 }], { names: {} }));

    expect(await screen.findByText("Your opponent declined the rematch")).toBeInTheDocument();
    expect(screen.queryByText(/took/)).toBeNull();
  });

  it("tells the asker nothing on the room's own page, where the banner says it", async () => {
    const mine = request({ from: GUEST.id, to: BOB });
    const { push } = await openHome({ path: "/games/chess/rooms/AB2CD3" });
    push(pushed([mine]));

    push(pushed([{ ...mine, state: "declined", endedAt: T + 1 }]));

    expect(screen.queryByText("Bob declined the rematch")).toBeNull();
  });

  it("says Reconnecting instead of sending while the connection is lost", async () => {
    const user = userEvent.setup();
    const { push, socket } = await openHome();
    push(pushed([request()]));

    act(() => socket.push("disconnect", "transport close"));
    await user.click(within(question()).getByRole("button", { name: "Accept and go" }));

    expect(socket.request).not.toHaveBeenCalledWith("room:answer", expect.anything());
    expect(within(question()).getAllByText("Reconnecting").length).toBeGreaterThan(0);
  });
});
