import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOCKET_EVENTS } from "@classicade/shared";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, GUEST, NO_FRIENDS } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-052, ADR-066: the friends page. An account sees friends with their presence, the requests waiting for them,
// the ones they sent, their friend link and the Appear offline switch. A guest sees how to save their progress.
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const ARJUN = {
  handle: "k3m9q2x7p4w8z1ab",
  displayName: "Arjun",
  avatar: "rocket",
  presence: "playing",
  since: 1,
  profile: "k3m9q2x7p4w8z1ab",
};
const KABIR = { handle: "q2x7p4w8z1abk3m9", displayName: "Kabir", presence: "online", since: 2 };
const MEERA_ASKS = {
  requestId: "00000000-0000-4000-9000-000000000001",
  displayName: "Meera",
  via: "link",
  sentAt: 3,
};
const TO_SAM = { requestId: "00000000-0000-4000-9000-000000000002", displayName: "Sam", sentAt: 4 };
const VIEW = {
  ...NO_FRIENDS,
  friends: [ARJUN, KABIR],
  incoming: [MEERA_ASKS],
  outgoing: [TO_SAM],
  safetyTips: false,
};

const friendsApi = (overrides = {}) =>
  fakeApi({ getSession: vi.fn(async () => USER), getFriends: vi.fn().mockResolvedValue(VIEW), ...overrides });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the friends page (CC-052)", () => {
  it("tells a guest to save their progress, and asks the server nothing", async () => {
    const api = fakeApi({ getSession: vi.fn(async () => GUEST) });
    renderApp({ path: "/friends", api });

    expect(await screen.findByText("Friends banane ke liye apni progress save karo.")).toBeVisible();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "Save progress" })).toHaveAttribute(
      "href",
      "/signup?next=%2Ffriends",
    );
    expect(main.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?next=%2Ffriends");
    expect(api.getFriends).not.toHaveBeenCalled();
  });

  // CC-324, the audit's bug 1: with no session at all the page said "Loading…" for ever and asked nothing.
  it("shows a visitor what friends are for and how to sign in, instead of loading for ever", async () => {
    const api = fakeApi({ getSession: vi.fn(async () => undefined) });
    renderApp({ path: "/friends", api });

    const empty = await screen.findByRole("region", { name: "Play with your friends" });
    expect(within(empty).getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup?next=%2Ffriends",
    );
    expect(within(empty).getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login?next=%2Ffriends",
    );
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(api.getFriends).not.toHaveBeenCalled();
  });

  it("says Loading while the session is still unknown", async () => {
    const api = fakeApi({ getSession: vi.fn(() => new Promise(() => {})) });
    renderApp({ path: "/friends", api });

    expect(await screen.findByText("Loading…")).toBeInTheDocument();
  });

  it("says so when an account has no friends yet", async () => {
    renderApp({ path: "/friends", api: friendsApi({ getFriends: vi.fn().mockResolvedValue(NO_FRIENDS) }) });

    expect(await screen.findByText("Abhi tumhare koi friends nahi hain.")).toBeVisible();
    expect(screen.queryByRole("list", { name: "Friend requests" })).toBeNull();
    // Unknown ages and minors are shown who to add (Ofcom ICU F2.3). This view has no requests to show it beside.
    expect(screen.queryByText(/Only add people you know/)).toBeNull();
  });

  it("lists friends with their avatar, a profile link for an adult, and presence, never which game", async () => {
    renderApp({ path: "/friends", api: friendsApi() });
    const list = await screen.findByRole("list", { name: "Friends" });
    const [arjun, kabir] = within(list).getAllByRole("listitem");

    expect(within(arjun).getByRole("link", { name: "Arjun" })).toHaveAttribute(
      "href",
      "/players/k3m9q2x7p4w8z1ab",
    );
    expect(within(arjun).getByText("In a game")).toBeVisible();
    expect(within(kabir).queryByRole("link")).toBeNull();
    expect(within(kabir).getByText("Online")).toBeVisible();
  });

  it("follows a friend's presence as the server pushes it, and the whole view when it changes", async () => {
    const socket = fakeSocket();
    renderApp({ path: "/friends", api: friendsApi(), socket });
    const list = await screen.findByRole("list", { name: "Friends" });

    act(() =>
      socket.push(SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED, { handle: ARJUN.handle, presence: "offline" }),
    );
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("Offline");

    act(() => socket.push(SOCKET_EVENTS.FRIENDS_UPDATED, { ...VIEW, friends: [KABIR] }));
    expect(
      within(await screen.findByRole("list", { name: "Friends" })).getAllByRole("listitem"),
    ).toHaveLength(1);
  });

  it("accepts a request, or declines it with Not now, and shows the view the server answers then", async () => {
    const api = friendsApi();
    api.getFriends
      .mockResolvedValueOnce({ ...VIEW, safetyTips: true })
      .mockResolvedValue({ ...VIEW, incoming: [] });
    renderApp({ path: "/friends", api });
    const requests = await screen.findByRole("list", { name: "Friend requests" });

    expect(screen.getByText("Sirf unhe add karo jinhe tum sach mein jaante ho.")).toBeVisible();
    expect(within(requests).getByText("Opened your friend link")).toBeVisible();
    await userEvent.click(within(requests).getByRole("button", { name: "Accept Meera" }));

    expect(api.answerFriendRequest).toHaveBeenCalledWith(MEERA_ASKS.requestId, "accept");
    await waitFor(() => expect(screen.queryByRole("list", { name: "Friend requests" })).toBeNull());
  });

  it("declines with Not now", async () => {
    const api = friendsApi();
    renderApp({ path: "/friends", api });
    const requests = await screen.findByRole("list", { name: "Friend requests" });

    await userEvent.click(within(requests).getByRole("button", { name: "Not now, Meera" }));

    expect(api.answerFriendRequest).toHaveBeenCalledWith(MEERA_ASKS.requestId, "decline");
  });

  it("cancels a request the player sent, which says only 'Request sent' until then", async () => {
    const api = friendsApi();
    renderApp({ path: "/friends", api });
    const sent = await screen.findByRole("list", { name: "Requests you sent" });

    expect(within(sent).getByText("Request sent")).toBeVisible();
    await userEvent.click(within(sent).getByRole("button", { name: "Cancel the request to Sam" }));

    expect(api.cancelFriendRequest).toHaveBeenCalledWith(TO_SAM.requestId);
  });

  it("asks before removing a friend, says they are not told, and removes them by handle", async () => {
    const api = friendsApi();
    renderApp({ path: "/friends", api });

    await userEvent.click(await screen.findByRole("button", { name: "Remove Arjun" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Arjun?" });
    expect(dialog).toHaveTextContent("Arjun is not told.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Remove Arjun" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));

    expect(api.removeFriend).toHaveBeenCalledWith(ARJUN.handle);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("switches Appear offline", async () => {
    const api = friendsApi();
    api.getFriends
      .mockResolvedValueOnce(VIEW)
      .mockResolvedValue({ ...VIEW, settings: { appearOffline: true } });
    renderApp({ path: "/friends", api });

    await userEvent.click(await screen.findByRole("button", { name: "Appear offline: off" }));

    expect(api.setAppearOffline).toHaveBeenCalledWith(true);
    expect(await screen.findByRole("button", { name: "Appear offline: on" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("makes a friend link to copy or send on WhatsApp, marked with the channel it leaves by", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderApp({ path: "/friends", api: friendsApi() });

    await userEvent.click(await screen.findByRole("button", { name: "Make a friend link" }));
    const box = await screen.findByRole("textbox", { name: "Friend link" });
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(box.value).toMatch(/\/friends\/add\/AbCdEfGhIjKlMnOpQrSt_-\?via=copy$/);
    expect(writeText).toHaveBeenCalledWith(box.value);
    const whatsapp = decodeURIComponent(
      screen.getByRole("link", { name: /Send on WhatsApp/ }).getAttribute("href"),
    );
    expect(whatsapp).toContain("mere friend bano");
    expect(whatsapp).toMatch(/\/friends\/add\/AbCdEfGhIjKlMnOpQrSt_-\?via=wa$/);
  });

  it("selects the whole link when the box is focused, ready to copy by hand", async () => {
    renderApp({ path: "/friends", api: friendsApi() });

    await userEvent.click(await screen.findByRole("button", { name: "Make a friend link" }));
    const box = await screen.findByRole("textbox", { name: "Friend link" });
    await userEvent.click(box);

    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);
  });

  it("reads the view again after a push that came while it was being read, so an older answer never stays", async () => {
    const socket = fakeSocket();
    let answer;
    const api = friendsApi({
      getFriends: vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
        .mockResolvedValue({ ...VIEW, friends: [{ ...ARJUN, presence: "offline" }] }),
    });
    renderApp({ path: "/friends", api, socket });
    await waitFor(() => expect(api.getFriends).toHaveBeenCalled());

    act(() =>
      socket.push(SOCKET_EVENTS.FRIEND_PRESENCE_CHANGED, { handle: ARJUN.handle, presence: "offline" }),
    );
    expect(screen.getByText("Loading…")).toBeVisible();
    await act(async () => answer(VIEW));

    const list = await screen.findByRole("list", { name: "Friends" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(within(list).getByText("Offline")).toBeVisible();
    expect(api.getFriends).toHaveBeenCalledTimes(2);
  });

  it("drops an answer that arrives after the player left the page", async () => {
    let answer;
    const api = friendsApi({ getFriends: vi.fn(() => new Promise((resolve) => (answer = resolve))) });
    const app = renderApp({ path: "/friends", api });
    await waitFor(() => expect(api.getFriends).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("link", { name: "Leaderboards" }));
    await act(async () => answer(VIEW));

    expect(app.url()).toBe("/leaderboards/overall");
    expect(screen.queryByRole("list", { name: "Friends" })).toBeNull();
  });

  it("says when the link could not be copied", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    });
    renderApp({ path: "/friends", api: friendsApi() });

    await userEvent.click(await screen.findByRole("button", { name: "Make a friend link" }));
    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));

    expect(await screen.findByText("Couldn't copy. Select the link and copy it")).toBeVisible();
  });

  it("says when the friends could not be loaded, and tries again", async () => {
    const api = friendsApi({
      getFriends: vi
        .fn()
        .mockRejectedValueOnce(new AppRequestError({ code: "UNKNOWN", message: "Server down", status: 500 }))
        .mockResolvedValue(NO_FRIENDS),
    });
    renderApp({ path: "/friends", api });

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your friends. Server down");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Abhi tumhare koi friends nahi hain.")).toBeVisible();
  });
});
