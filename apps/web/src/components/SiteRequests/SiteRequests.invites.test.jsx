import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, fakeSocket, fakeSound } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-052 part 2: how invites to friends end, on any page. Their sender reads the same "Not right now" for a decline
// and for an invite that ran out with no answer, which is also how a block reads (ADR-053). A friend whose invite
// another friend took first reads "Game filled", with the way to invite the sender again.
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const invite = (overrides = {}) => ({
  id: "c0000000000000000001",
  gameId: "chess",
  options: {},
  createdAt: Date.now(),
  fromName: "Riya",
  own: true,
  forYou: false,
  took: false,
  later: false,
  toOne: true,
  toName: "Arjun",
  state: "open",
  expiresAt: Date.now() + 86_400_000,
  ...overrides,
});

async function open() {
  const socket = fakeSocket();
  socket.connect();
  const api = fakeApi({ getSession: async () => USER });
  const view = renderApp({ path: "/", socket, sound: fakeSound(), api });
  await screen.findByText(USER.displayName);
  const push = (challenge) => act(() => socket.push("challenge:updated", { challenge }));
  return { ...view, push };
}

const NOT_RIGHT_NOW = /Not right now: Arjun can't play at the moment\. Try again later\./;

describe("SiteRequests: how invites end (CC-052 part 2)", () => {
  it("says Not right now for a decline and for an invite that ran out", async () => {
    const { push } = await open();
    const declined = invite();
    push(declined);
    push({ ...declined, state: "declined", expiresAt: undefined });
    expect(await screen.findByText(NOT_RIGHT_NOW)).toBeInTheDocument();

    // An invite nobody answered: the tab lets it go at its end, and its sender reads exactly the same words.
    push(invite({ id: "c0000000000000000002", toName: "Kabir", expiresAt: Date.now() + 150 }));
    expect(
      await screen.findByText(
        /Not right now: Kabir can't play at the moment\. Try again later\./,
        {},
        { timeout: 2_000 },
      ),
    ).toBeInTheDocument();
  });

  it("says nothing when a link challenge runs out, or an invite was taken back", async () => {
    const { push } = await open();
    push(invite({ toOne: undefined, toName: undefined, expiresAt: Date.now() + 100 }));
    const mine = invite({ id: "c0000000000000000002" });
    push(mine);
    push({ ...mine, state: "withdrawn", expiresAt: undefined });

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.queryByText(/Not right now/)).toBeNull();
  });

  it("tells a friend the game filled, with the way to invite the sender again", async () => {
    const { push } = await open();
    const toMe = invite({ own: false, forYou: true, toName: undefined, fromName: "Meera" });
    push(toMe);
    push({ ...toMe, state: "filled", expiresAt: undefined });

    const toast = (await screen.findByText(/Game filled: Meera is playing someone else now\./)).closest(
      "[role='status'], li, div",
    );
    expect(within(toast.parentElement).getByRole("link", { name: "Invite again?" })).toHaveAttribute(
      "href",
      "/challenge/c0000000000000000001",
    );
    await userEvent.click(within(toast.parentElement).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(/Game filled/)).toBeNull();
    // The popup of the invite is gone: it can no longer be accepted.
    expect(screen.queryByRole("region", { name: "Challenge" })).toBeNull();
  });
});
