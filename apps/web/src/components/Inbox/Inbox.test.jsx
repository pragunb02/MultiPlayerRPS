import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeApi, fakeSocket, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";
import { CHALLENGE_COPY } from "../Challenges/challengeCopy.js";

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
  it("is only there for a player", async () => {
    renderApp({ api: fakeApi({ getSession: async () => undefined }) });

    await screen.findByRole("link", { name: "Log in" });
    expect(screen.queryByRole("button", { name: /^Inbox/ })).not.toBeInTheDocument();
  });

  it("says when nothing is waiting", async () => {
    const { panel, button } = await openInbox([]);

    expect(button).toHaveAccessibleName("Inbox");
    expect(panel).toHaveTextContent(CHALLENGE_COPY.inboxEmpty.en);
  });

  it("counts what asks for an answer, and lists a challenge sent to the player with Accept and go", async () => {
    const { panel, button, user, api, url } = await openInbox([challenge()], {
      acceptChallenge: vi.fn().mockResolvedValue({
        challenge: challenge({ state: "accepted", took: true }),
        room: { code: "AB2CD3", gameId: "chess" },
      }),
    });

    expect(button).toHaveAccessibleName("Inbox, 1 waiting");
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
    await waitFor(() => expect(panel).toHaveTextContent(CHALLENGE_COPY.inboxEmpty.en));
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

  it("leaves out what is over and what was never the player's to answer", async () => {
    const { panel } = await openInbox([
      challenge({ state: "expired" }),
      challenge({ id: "c0000000000000000004", own: false, forYou: false }),
      challenge({ id: "c0000000000000000005", own: true, forYou: false, state: "accepted" }),
      challenge({ id: "c0000000000000000006", forYou: false, took: true, state: "accepted" }),
    ]);

    expect(panel).toHaveTextContent(CHALLENGE_COPY.inboxEmpty.en);
  });
});
