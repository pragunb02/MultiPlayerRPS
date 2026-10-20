import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CHALLENGE_COPY } from "../../components/Challenges/challengeCopy.js";
import { INVITE_COPY } from "../../components/Friends/inviteCopy.js";
import { fakeApi, fakeSocket } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { renderApp } from "../../testing/render.jsx";

// CC-052 part 2: an invite's own page. Its sender sees who it waits for and reads "Not right now" for a decline and
// for no answer alike. Its friend sees "Game filled" with Invite again. Anyone else holding a forwarded invite is
// told it is for someone else, instead of a button that cannot work.
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Meera" };
const ID = "c0000000000000000001";
const invite = (overrides = {}) => ({
  id: ID,
  gameId: "chess",
  options: {},
  fromName: "Riya",
  own: false,
  forYou: true,
  took: false,
  later: false,
  toOne: true,
  state: "open",
  expiresAt: Date.now() + 23 * 60 * 60 * 1000,
  ...overrides,
});

function openPage({ view, on = true, session = USER, api: overrides = {} }) {
  const socket = fakeSocket();
  socket.connect();
  const api = fakeApi({
    getSession: async () => (session === "visitor" ? undefined : session),
    getChallenge: vi.fn().mockResolvedValue(view),
    getFlags: vi.fn(async (names) => Object.fromEntries(names.map((name) => [name, on]))),
    ...overrides,
  });
  return { ...renderApp({ path: `/challenge/${ID}`, socket, api }), api };
}

describe("an invite's page (CC-052 part 2)", () => {
  flagPaths("friend_invites", (on) => {
    it("shows a filled invite as Game filled, with Invite again", async () => {
      const back = invite({ id: "c0000000000000000009", own: true, forYou: false, toName: "Riya" });
      const { api, url } = openPage({
        on,
        view: invite({ state: "filled", expiresAt: undefined }),
        api: { inviteAgain: vi.fn().mockResolvedValue(back) },
      });

      expect(await screen.findByRole("heading", { name: "Game filled" })).toBeInTheDocument();
      expect(screen.getByText(INVITE_COPY.gameFilled("Riya").en)).toBeInTheDocument();
      if (!on) {
        await waitFor(() => expect(api.getFlags).toHaveBeenCalled());
        expect(screen.queryByRole("button", { name: "Invite Riya again" })).toBeNull();
        return;
      }
      await userEvent.click(await screen.findByRole("button", { name: "Invite Riya again" }));

      expect(api.inviteAgain).toHaveBeenCalledWith(ID);
      await waitFor(() => expect(url()).toBe("/challenge/c0000000000000000009"));
    });
  });

  it.each([
    ["declined", "Not right now"],
    ["expired", "Not right now"],
  ])("shows its sender a %s invite as Not right now", async (state, title) => {
    openPage({ view: invite({ state, own: true, forYou: false, toName: "Arjun", expiresAt: undefined }) });

    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(CHALLENGE_COPY.notRightNow("Arjun").en)).toBeInTheDocument();
  });

  it("still shows an expired link challenge as expired", async () => {
    openPage({ view: invite({ state: "expired", own: true, forYou: false, toOne: undefined }) });

    expect(await screen.findByRole("heading", { name: "Challenge expired" })).toBeInTheDocument();
  });

  it("shows its sender who it waits for, with WhatsApp words for a friend", async () => {
    openPage({ view: invite({ own: true, forYou: false, toName: "Arjun", fromName: "Meera" }) });

    expect(await screen.findByRole("heading", { name: "Your Chess invite" })).toBeInTheDocument();
    expect(screen.getByText(INVITE_COPY.yours("Arjun", "Chess").en)).toBeInTheDocument();
    const whatsapp = screen.getByRole("link", { name: "Send on WhatsApp" });
    expect(decodeURIComponent(whatsapp.getAttribute("href"))).toContain("I invited you on ClassiCade");
  });

  it("tells anyone else holding a forwarded invite that it is for someone else", async () => {
    openPage({ view: invite({ forYou: false, fromName: "" }), session: "visitor" });

    expect(
      await screen.findByRole("heading", { name: "This invite is for someone else" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Accept|Play as guest/ })).toBeNull();
    expect(screen.getByRole("main").querySelector("a[href^='/login']")).not.toBeNull();
  });
});
