import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, fakeSocket, fakeSound, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { installVisibility } from "../../testing/visibility.js";

// CC-139 and CC-207: challenges reach a player on any page as a popup with Accept and go and Not now, move to the
// inbox after about a minute or on Not now, and never interrupt a game on the room page.
// Relative to today, so a challenge made "now" in a test is still open on any day the tests run.
const T = Date.now();
const sentToYou = (overrides = {}) => ({
  id: "c0000000000000000001",
  gameId: "chess",
  options: {},
  createdAt: T,
  fromName: "Riya",
  own: false,
  forYou: true,
  took: false,
  later: false,
  state: "open",
  expiresAt: T + 86_400_000,
  ...overrides,
});
const yoursTaken = (overrides = {}) =>
  sentToYou({
    id: "c0000000000000000002",
    own: true,
    forYou: false,
    fromName: GUEST.displayName,
    state: "accepted",
    expiresAt: undefined,
    acceptedName: "Arjun",
    room: { code: "AB2CD3", gameId: "chess" },
    ...overrides,
  });

async function open({ path = "/", api: apiOverrides = {}, joined } = {}) {
  const socket = fakeSocket();
  socket.connect();
  // A room the test does not describe is still joining, as a real server that has not answered yet.
  socket.request.mockImplementation((event) =>
    event === "room:join" && joined === undefined ? new Promise(() => {}) : Promise.resolve(joined ?? {}),
  );
  const sound = fakeSound();
  const api = fakeApi({ getSession: async () => GUEST, ...apiOverrides });
  const view = renderApp({ path, socket, sound, api });
  await screen.findByText(GUEST.displayName);
  // The first read of the inbox has answered, so nothing it says can arrive in the middle of a test.
  await waitFor(() => expect(api.getChallenges).toHaveBeenCalled());
  await act(async () => {
    await api.getChallenges.mock.results[0].value.catch(() => undefined);
  });
  const push = (challenge) => act(() => socket.push("challenge:updated", { challenge }));
  return { ...view, socket, sound, api, push };
}

const popup = (name = "Challenge") => screen.queryByRole("region", { name });

describe("SiteRequests: challenges (CC-139, CC-207)", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a challenge sent to the player on any page, in Hinglish and English, with a chime", async () => {
    const { push, sound } = await open();
    await screen.findByRole("button", { name: "Sound on" });

    push(sentToYou());

    const question = popup();
    expect(within(question).getByRole("alert")).toHaveTextContent(
      "Riya ne tumhe Chess ka challenge diya hai. Riya challenges you to Chess.",
    );
    expect(sound.played).toEqual(["notify"]);
  });

  it("names a challenger the player may not see as a ClassiCade player", async () => {
    const { push } = await open();

    push(sentToYou({ fromName: "" }));

    expect(within(popup()).getByRole("alert")).toHaveTextContent(
      "A ClassiCade player challenges you to Chess.",
    );
  });

  it("takes the challenge and goes to its room on Accept and go", async () => {
    const user = userEvent.setup();
    const { push, api, url } = await open({
      api: {
        acceptChallenge: vi.fn().mockResolvedValue({
          challenge: sentToYou({ state: "accepted", took: true }),
          room: { code: "ZZ2CD3", gameId: "chess" },
        }),
      },
    });
    push(sentToYou());

    const question = await screen.findByRole("region", { name: "Challenge" }, { timeout: 3_000 });
    await user.click(within(question).getByRole("button", { name: "Accept and go" }));

    expect(api.acceptChallenge).toHaveBeenCalledWith("c0000000000000000001");
    await waitFor(() => expect(url()).toBe("/games/chess/rooms/ZZ2CD3"), { timeout: 3_000 });
    expect(popup()).not.toBeInTheDocument();
  });

  it("moves it to the inbox on Not now, without answering it", async () => {
    const user = userEvent.setup();
    const { push, api } = await open();
    push(sentToYou());

    await user.click(within(popup()).getByRole("button", { name: "Not now" }));

    expect(popup()).not.toBeInTheDocument();
    expect(api.challengeLater).toHaveBeenCalledWith("c0000000000000000001");
    expect(api.declineChallenge).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Inbox, 1 waiting" })).toBeInTheDocument();
  });

  it("moves it to the inbox by itself once it has been on screen for a minute", async () => {
    const { push, api } = await open();
    vi.useFakeTimers();
    push(sentToYou());

    act(() => vi.advanceTimersByTime(59_000));
    expect(popup()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));

    expect(popup()).not.toBeInTheDocument();
    expect(api.challengeLater).toHaveBeenCalledWith("c0000000000000000001");
  });

  it("still shows pushes when the inbox could not be read, and Not now works when the server misses it", async () => {
    const user = userEvent.setup();
    const { push, api } = await open({
      api: {
        getChallenges: vi.fn().mockRejectedValue(new Error("down")),
        challengeLater: vi.fn().mockRejectedValue(new Error("down")),
      },
    });
    await waitFor(() => expect(api.getChallenges).toHaveBeenCalled());

    push(sentToYou());
    await user.click(within(popup()).getByRole("button", { name: "Not now" }));

    expect(popup()).not.toBeInTheDocument();
  });

  it("counts each popup's minute from when it showed, and forgets one that went away", async () => {
    const { push, api } = await open();
    vi.useFakeTimers();
    push(sentToYou());
    act(() => vi.advanceTimersByTime(30_000));
    push(sentToYou({ id: "c0000000000000000007", fromName: "Arjun" }));

    act(() => vi.advanceTimersByTime(30_000));
    expect(api.challengeLater.mock.calls).toEqual([["c0000000000000000001"]]);
    expect(popup()).toHaveTextContent("Arjun challenges you to Chess.");

    push(sentToYou({ id: "c0000000000000000007", fromName: "Arjun", state: "withdrawn" }));
    act(() => vi.advanceTimersByTime(60_000));
    expect(api.challengeLater.mock.calls).toEqual([["c0000000000000000001"]]);
  });

  it("counts only the time the tab is in front: a popup never moves to the inbox unseen", async () => {
    const tab = installVisibility({ hidden: false });
    const { push, api } = await open();
    vi.useFakeTimers();
    act(() => tab.setHidden(true));
    push(sentToYou());

    act(() => vi.advanceTimersByTime(2 * 60_000));
    expect(popup()).toBeInTheDocument();
    expect(api.challengeLater).not.toHaveBeenCalled();
    expect(document.title).toMatch(/Challenge/);

    act(() => tab.setHidden(false));
    act(() => vi.advanceTimersByTime(59_000));
    expect(popup()).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(popup()).not.toBeInTheDocument();
    expect(api.challengeLater).toHaveBeenCalledWith("c0000000000000000001");
  });

  it("keeps a challenge pushed while the inbox was still being read", async () => {
    let answer;
    const reading = new Promise((resolve) => {
      answer = resolve;
    });
    const socket = fakeSocket();
    socket.connect();
    const api = fakeApi({ getSession: async () => GUEST, getChallenges: vi.fn(() => reading) });
    renderApp({ socket, api });
    await screen.findByText(GUEST.displayName);
    await waitFor(() => expect(api.getChallenges).toHaveBeenCalled());

    act(() => socket.push("challenge:updated", { challenge: sentToYou() }));
    await act(async () => answer([]));

    expect(popup()).toBeInTheDocument();
  });

  it("tells the creator on any page that someone took their challenge, and Go and play opens the room", async () => {
    const user = userEvent.setup();
    const { push, api, url } = await open();

    push(yoursTaken());
    const taken = popup("Challenge taken");
    expect(within(taken).getByRole("alert")).toHaveTextContent("Arjun took your Chess challenge.");
    await user.click(within(taken).getByRole("button", { name: "Go and play" }));

    await waitFor(() => expect(url()).toBe("/games/chess/rooms/AB2CD3"), { timeout: 3_000 });
    expect(api.challengeLater).toHaveBeenCalledWith("c0000000000000000002");
  });

  it("shows nothing that is already in the inbox, or on the page it would lead to", async () => {
    const { push } = await open({
      path: "/challenge/c0000000000000000001",
      api: { getChallenge: vi.fn(() => new Promise(() => {})) },
    });

    push(sentToYou());
    push(yoursTaken({ later: true }));

    expect(popup()).not.toBeInTheDocument();
    expect(popup("Challenge taken")).not.toBeInTheDocument();
  });

  it("tells the creator gently when the one person said no", async () => {
    const { push } = await open();
    const asked = sentToYou({ id: "c0000000000000000003", own: true, forYou: false, toName: "Arjun" });
    push(asked);
    // The page must have seen the challenge open before it hears it was declined, or there is no change to tell
    // of. A busy runner can still be on the first push when the second arrives (CI, 2026-10-21).
    await act(async () => {});
    await act(async () => {});

    push({ ...asked, state: "declined", expiresAt: undefined });

    expect(await screen.findByText(/Arjun can't play right now\./)).toBeInTheDocument();
  });

  it("reads the inbox again whenever the socket connects again", async () => {
    const { socket, api } = await open();
    await waitFor(() => expect(api.getChallenges).toHaveBeenCalledTimes(1));
    api.getChallenges.mockResolvedValueOnce([sentToYou()]);

    act(() => socket.push("connect"));

    expect(await screen.findByRole("region", { name: "Challenge" })).toBeInTheDocument();
  });

  it("never interrupts a game on the room page: everything waits until the game ends", async () => {
    installVisibility({ hidden: true });
    const me = { playerId: "seatOfMe", displayName: GUEST.displayName, connected: true };
    const bob = { playerId: "seatOfBob", displayName: "Bob", connected: true };
    const room = {
      code: "AB2CD3",
      gameId: "ludo",
      status: "playing",
      hostId: "seatOfMe",
      players: { min: 2, max: 2 },
      seats: [me, bob],
      you: "seatOfMe",
      game: { view: {}, activePlayers: ["seatOfBob"], outcome: { status: "ongoing" } },
    };
    const { push, sound, socket } = await open({ path: "/games/ludo/rooms/AB2CD3", joined: room });
    await screen.findByRole("list", { name: "Players" });
    const title = document.title;

    push(sentToYou());
    expect(popup()).not.toBeInTheDocument();
    expect(sound.played).not.toContain("notify");
    expect(document.title).toBe(title);

    act(() =>
      socket.push("room:updated", {
        ...room,
        status: "finished",
        game: {
          ...room.game,
          activePlayers: [],
          outcome: { status: "finished", result: "draw", winners: [] },
        },
      }),
    );

    expect(await screen.findByRole("region", { name: "Challenge" })).toBeInTheDocument();
    expect(sound.played).toContain("notify");
    installVisibility({ hidden: false });
  });
});
