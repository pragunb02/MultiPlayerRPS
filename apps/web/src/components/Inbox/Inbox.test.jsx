import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, fakeSocket, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-207, the minimal CC-147: the inbox in the header lists the challenges that wait for the player.
const T = Date.UTC(2026, 9, 20, 12);
const challenge = (overrides = {}) => ({
  id: "c0000000000000000001",
  gameId: "chess",
  options: {},
  createdAt: T,
  fromName: "Riya",
  own: false,
  forYou: true,
  took: false,
  later: true,
  state: "open",
  expiresAt: T + 86_400_000,
  ...overrides,
});

async function renderInbox(challenges, apiOverrides = {}) {
  const socket = fakeSocket();
  socket.connect();
  const api = fakeApi({
    getSession: async () => GUEST,
    getChallenges: vi.fn().mockResolvedValue(challenges),
    ...apiOverrides,
  });
  const view = renderApp({ socket, api });
  await screen.findByText(GUEST.displayName);
  return { ...view, api };
}

async function openInbox(challenges, apiOverrides = {}) {
  const user = userEvent.setup();
  const socket = fakeSocket();
  socket.connect();
  const api = fakeApi({
    getSession: async () => GUEST,
    getChallenges: vi.fn().mockResolvedValue(challenges),
    ...apiOverrides,
  });
  const view = renderApp({ socket, api });
  await screen.findByText(GUEST.displayName);
  const button = await screen.findByRole("button", { name: /^Inbox/ });
  await user.click(button);
  return { ...view, user, api, button, panel: screen.getByRole("region", { name: "Inbox" }) };
}

describe("Inbox (CC-207)", () => {
  afterEach(() => vi.useRealTimers());

  it("is only there for a player", async () => {
    renderApp({ api: fakeApi({ getSession: async () => undefined }) });

    await screen.findByRole("link", { name: "Log in" });
    expect(screen.queryByRole("button", { name: /^Inbox/ })).not.toBeInTheDocument();
  });

  it("is not in the header while nothing is in it, and counts nothing for challenges that only wait", async () => {
    const { api } = await renderInbox([]);
    await waitFor(() => expect(api.getChallenges).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /^Inbox/ })).not.toBeInTheDocument();
  });

  // CC-324, the audit's bug 4 (axe label-content-name-mismatch): the name was "Inbox, 1 waiting" while the button
  // showed "Inbox 1", so a voice user saying "Inbox 1" pressed nothing.
  it("has a name that starts with the words on the button (label in name)", async () => {
    const { button } = await openInbox([challenge()]);
    const shown = [...button.childNodes]
      .filter((node) => !(node instanceof Element && node.classList.contains("visually-hidden")))
      .map((node) => node.textContent.trim())
      .filter(Boolean)
      .join(" ");

    expect(shown).toBe("Inbox 1");
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).toHaveAccessibleName("Inbox 1 waiting");
  });

  it("names a challenge of the player's that only waits without a count", async () => {
    const { button } = await openInbox([challenge({ own: true, forYou: false })]);

    expect(button).toHaveAccessibleName("Inbox");
  });

  it("counts what asks for an answer, and lists a challenge sent to the player with Accept and go", async () => {
    const { panel, button, user, api, url } = await openInbox([challenge()], {
      acceptChallenge: vi.fn().mockResolvedValue({
        challenge: challenge({ state: "accepted", took: true }),
        room: { code: "AB2CD3", gameId: "chess" },
      }),
    });

    expect(button).toHaveAccessibleName("Inbox 1 waiting");
    expect(panel).toHaveTextContent("Riya challenges you to Chess.");
    await user.click(within(panel).getByRole("button", { name: "Accept and go" }));

    expect(api.acceptChallenge).toHaveBeenCalledWith("c0000000000000000001");
    await waitFor(() => expect(url()).toBe("/games/chess/rooms/AB2CD3"));
  });

  it("names a game this build does not know as a game", async () => {
    const { panel } = await openInbox([challenge({ gameId: "ludo" })]);

    expect(panel).toHaveTextContent("Riya challenges you to a game.");
  });

  it("says no with No thanks, and the challenge leaves the inbox", async () => {
    const { panel, user, api } = await openInbox([challenge()], {
      declineChallenge: vi.fn().mockResolvedValue(challenge({ state: "declined", expiresAt: undefined })),
    });

    await user.click(within(panel).getByRole("button", { name: "No thanks" }));

    expect(api.declineChallenge).toHaveBeenCalledWith("c0000000000000000001");
    await waitFor(() => expect(panel).not.toBeInTheDocument());
  });

  it("lists the player's own challenges: taken ones with Go and play, open ones with Share it and Take back", async () => {
    const taken = challenge({
      id: "c0000000000000000002",
      own: true,
      forYou: false,
      state: "accepted",
      acceptedName: "Arjun",
      room: { code: "AB2CD3", gameId: "chess" },
    });
    const waiting = challenge({ id: "c0000000000000000003", own: true, forYou: false, gameId: "rps" });
    const { panel, user, api } = await openInbox([taken, waiting], {
      withdrawChallenge: vi.fn().mockResolvedValue({ ...waiting, state: "withdrawn" }),
    });

    expect(within(panel).getByRole("link", { name: "Go and play" })).toHaveAttribute(
      "href",
      "/games/chess/rooms/AB2CD3",
    );
    expect(panel).toHaveTextContent("Your Rock Paper Scissors challenge is waiting for someone to take it.");
    expect(within(panel).getByRole("link", { name: "Share it" })).toHaveAttribute(
      "href",
      "/challenge/c0000000000000000003",
    );
    await user.click(within(panel).getByRole("button", { name: "Take back" }));

    expect(api.withdrawChallenge).toHaveBeenCalledWith("c0000000000000000003");
    await waitFor(() =>
      expect(within(panel).queryByRole("link", { name: "Share it" })).not.toBeInTheDocument(),
    );
  });

  it("lets an open challenge go once it expires, and a taken one once its room stops waiting", async () => {
    // Only the end state is checked: however slow the machine, the page must let both go by themselves. The
    // timer to the next end runs even when that end has already passed by the time the list arrives.
    const now = Date.now();
    const { api } = await renderInbox([
      challenge({ expiresAt: now + 300 }),
      challenge({
        id: "c0000000000000000002",
        own: true,
        forYou: false,
        state: "accepted",
        expiresAt: undefined,
        acceptedName: "Arjun",
        room: { code: "AB2CD3", gameId: "chess" },
        until: now + 600,
      }),
    ]);
    await waitFor(() => expect(api.getChallenges).toHaveBeenCalled());

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Inbox/ })).not.toBeInTheDocument(), {
      timeout: 10_000,
    });
  }, 20_000);

  it("leaves out what is over and what was never the player's to answer", async () => {
    const { api } = await renderInbox([
      challenge({ state: "expired", createdAt: undefined, expiresAt: undefined }),
      challenge({ id: "c0000000000000000009", state: "declined", createdAt: undefined }),
      challenge({ id: "c0000000000000000004", own: false, forYou: false }),
      challenge({ id: "c0000000000000000005", own: true, forYou: false, state: "accepted" }),
      challenge({ id: "c0000000000000000006", forYou: false, took: true, state: "accepted" }),
    ]);

    await waitFor(() => expect(api.getChallenges).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /^Inbox/ })).not.toBeInTheDocument();
  });
});
