import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { INVITE_COPY } from "../../components/Friends/inviteCopy.js";
import { fakeApi, NO_FRIENDS } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { renderApp } from "../../testing/render.jsx";

// CC-052 part 2: Invite beside each friend opens a game picker and sends an invite to one person. The picker then
// says what happens next, by where the friend is: on the site, in a game, or offline with Send on WhatsApp too.
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const friend = (displayName, presence, handle) => ({ handle, displayName, presence, since: 1 });
const ARJUN = friend("Arjun", "online", "k3m9q2x7p4w8z1ab");
const KABIR = friend("Kabir", "playing", "q2x7p4w8z1abk3m9");
const MEERA = friend("Meera", "offline", "p4w8z1abk3m9q2x7");
const INVITE = (gameId, toName) => ({
  id: "abcdefghjkmnpqrstvwx",
  gameId,
  options: {},
  state: "open",
  fromName: "Riya",
  own: true,
  forYou: false,
  took: false,
  later: false,
  toOne: true,
  toName,
  createdAt: 1,
  expiresAt: Date.now() + 1000 * 60 * 60,
});

function setup(on, overrides = {}) {
  const api = fakeApi({
    getSession: vi.fn(async () => USER),
    getFriends: vi
      .fn()
      .mockResolvedValue({ ...NO_FRIENDS, friends: [ARJUN, KABIR, MEERA], safetyTips: false }),
    getFlags: vi.fn(async (names) => Object.fromEntries(names.map((name) => [name, on]))),
    createChallenge: vi.fn(async ({ gameId, to }) =>
      INVITE(gameId, [ARJUN, KABIR, MEERA].find((each) => each.handle === to.handle).displayName),
    ),
    ...overrides,
  });
  renderApp({ path: "/friends", api });
  return { api };
}

const rowOf = async (name) =>
  within(await screen.findByRole("list", { name: "Friends" }))
    .getAllByRole("listitem")
    .find((item) => item.textContent.includes(name));

/** Every word of the invite copy, both languages. */
const allCopy = () =>
  Object.values(INVITE_COPY).flatMap((line) => {
    const copy = typeof line === "function" ? line("Arjun", "Chess") : line;
    return [copy.hi, copy.en];
  });

describe("inviting a friend from the friends page (CC-052 part 2)", () => {
  flagPaths("friend_invites", (on) => {
    it("invites a friend to a game and says what happens next", async () => {
      const { api } = setup(on);
      const arjun = await rowOf("Arjun");
      if (!on) {
        expect(within(arjun).queryByRole("button", { name: "Invite Arjun" })).toBeNull();
        expect(within(arjun).getByRole("button", { name: "Remove Arjun" })).toBeVisible();
        return;
      }

      await userEvent.click(await within(arjun).findByRole("button", { name: "Invite Arjun" }));
      const dialog = await screen.findByRole("dialog", { name: "Invite Arjun" });
      expect(within(dialog).getByText(INVITE_COPY.pickGame("Arjun").hi)).toBeVisible();
      const games = within(within(dialog).getByRole("list", { name: "Games" }));
      for (const name of ["Rock Paper Scissors", "Tic Tac Toe", "Chess"]) {
        expect(games.getByRole("button", { name })).toBeVisible();
      }
      await userEvent.click(within(dialog).getByRole("button", { name: "Chess" }));

      const sent = await screen.findByRole("dialog", { name: "Invite sent" });
      expect(api.createChallenge).toHaveBeenCalledWith({
        gameId: "chess",
        options: {},
        to: { handle: "k3m9q2x7p4w8z1ab" },
      });
      expect(within(sent).getByText(INVITE_COPY.sentOnline("Arjun").en)).toBeVisible();
      expect(within(sent).queryByRole("link", { name: "Send on WhatsApp" })).toBeNull();
      expect(within(sent).getByRole("link", { name: "See the invite" })).toHaveAttribute(
        "href",
        "/challenge/abcdefghjkmnpqrstvwx",
      );
      await userEvent.click(within(sent).getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog")).toBeNull();

      // A friend in a game sees it when the game ends. An offline friend finds it in their inbox, or on WhatsApp.
      await userEvent.click(within(await rowOf("Kabir")).getByRole("button", { name: "Invite Kabir" }));
      await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Tic Tac Toe" }));
      expect(await screen.findByText(INVITE_COPY.sentPlaying("Kabir").en)).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: "Done" }));

      await userEvent.click(within(await rowOf("Meera")).getByRole("button", { name: "Invite Meera" }));
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Rock Paper Scissors" }),
      );
      expect(await screen.findByText(INVITE_COPY.sentOffline("Meera").en)).toBeVisible();
      const whatsapp = screen.getByRole("link", { name: "Send on WhatsApp" });
      expect(decodeURIComponent(whatsapp.getAttribute("href"))).toContain("/challenge/abcdefghjkmnpqrstvwx");
      expect(decodeURIComponent(whatsapp.getAttribute("href"))).not.toContain("Riya");
    });

    it("shows the server's words when an invite cannot go", async () => {
      setup(on, {
        createChallenge: vi.fn(async () => {
          throw new AppRequestError({
            message: "You challenged them a moment ago. Try again in a few minutes",
            status: 409,
            code: "CONFLICT",
          });
        }),
      });
      const arjun = await rowOf("Arjun");
      if (!on) {
        expect(within(arjun).queryByRole("button", { name: "Invite Arjun" })).toBeNull();
        return;
      }

      await userEvent.click(await within(arjun).findByRole("button", { name: "Invite Arjun" }));
      await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Chess" }));

      expect(await screen.findByText(/You challenged them a moment ago/)).toBeVisible();
      expect(screen.getByRole("dialog", { name: "Invite Arjun" })).toBeVisible();
    });
  });

  it('speaks with "tum", never "aap"', () => {
    const words = allCopy();

    expect(words.some((text) => /\btum(he|hara|hari|hare)?\b/i.test(text))).toBe(true);
    expect(words.filter((text) => /\baap(ka|ke|ki|ko|ne)?\b/i.test(text))).toEqual([]);
  });
});
