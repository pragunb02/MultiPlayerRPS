import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHALLENGE_COPY } from "../../components/Challenges/challengeCopy.js";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, fakeSocket, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-139: a challenge's own page, the link sent on WhatsApp, and the honest pages for a link that leads nowhere.
const ID = "c0000000000000000001";
const PATH = `/challenge/${ID}`;
const challenge = (overrides = {}) => ({
  id: ID,
  gameId: "chess",
  options: {},
  createdAt: Date.now(),
  fromName: "Riya",
  own: false,
  forYou: false,
  took: false,
  later: false,
  state: "open",
  expiresAt: Date.now() + 23.5 * 60 * 60 * 1000,
  ...overrides,
});

function openPage({ view = challenge(), session = GUEST, api: overrides = {} } = {}) {
  const socket = fakeSocket();
  socket.connect();
  const api = fakeApi({
    getSession: async () => (session === "visitor" ? undefined : session),
    getChallenge: view instanceof Error ? vi.fn().mockRejectedValue(view) : vi.fn().mockResolvedValue(view),
    ...overrides,
  });
  return { ...renderApp({ path: PATH, socket, api }), socket, api, user: userEvent.setup() };
}

const notFound = () => new AppRequestError({ code: "NOT_FOUND", message: "No such challenge", status: 404 });

describe("ChallengePage (CC-139)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows someone else's challenge with who sent it and Accept and play, which opens the room", async () => {
    const { user, api, url } = openPage({
      api: {
        acceptChallenge: vi.fn().mockResolvedValue({
          challenge: challenge({ state: "accepted", took: true }),
          room: { code: "AB2CD3", gameId: "chess" },
        }),
      },
    });

    const heading = await screen.findByRole("heading", { name: "You've been challenged to Chess" });
    // The page moves focus in an effect, which can run a moment after the heading is drawn.
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("Riya challenges you to Chess.")).toBeInTheDocument();
    expect(screen.getByText("Open for 24 more hours.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept and play" }));

    expect(api.acceptChallenge).toHaveBeenCalledWith(ID);
    await waitFor(() => expect(url()).toBe("/games/chess/rooms/AB2CD3"));
  });

  it("names a challenger the viewer may not see as a ClassiCade player", async () => {
    openPage({ view: challenge({ fromName: "", expiresAt: Date.now() + 1000 }) });

    expect(await screen.findByText("A ClassiCade player challenges you to Chess.")).toBeInTheDocument();
    expect(screen.getByText("Open for 1 more hour.")).toBeInTheDocument();
  });

  it("says why taking it failed, under the button", async () => {
    const { user } = openPage({
      api: {
        acceptChallenge: vi
          .fn()
          .mockRejectedValue(
            new AppRequestError({ code: "GONE", message: "Someone already took this challenge" }),
          ),
      },
    });

    await user.click(await screen.findByRole("button", { name: "Accept and play" }));

    expect(await screen.findByText("Someone already took this challenge")).toBeInTheDocument();
  });

  it("lets a visitor play as a guest first, or log in and come back", async () => {
    const { user, api } = openPage({ session: "visitor" });

    expect(await screen.findByText(CHALLENGE_COPY.signInFirst.en)).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=%2Fchallenge%2F${ID}`,
    );
    await user.click(screen.getByRole("button", { name: "Play as guest" }));

    expect(api.startGuest).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Accept and play" })).toBeInTheDocument();
  });

  it("gives its creator the link to send, on WhatsApp too, and Take back", async () => {
    const { user, api } = openPage({
      view: challenge({ own: true }),
      api: { withdrawChallenge: vi.fn().mockResolvedValue(challenge({ own: true, state: "withdrawn" })) },
    });
    // After userEvent.setup(), which puts in a clipboard of its own.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    expect(await screen.findByRole("heading", { name: "Your Chess challenge" })).toBeInTheDocument();
    const link = `${window.location.origin}${PATH}`;
    expect(screen.getByRole("textbox", { name: "Challenge link" })).toHaveValue(`${link}?via=copy`);
    const whatsapp = screen.getByRole("link", { name: "Send on WhatsApp" });
    expect(decodeURIComponent(whatsapp.getAttribute("href"))).toContain(`${link}?via=wa`);
    expect(decodeURIComponent(whatsapp.getAttribute("href"))).not.toContain(GUEST.displayName);
    const box = screen.getByRole("textbox", { name: "Challenge link" });
    await user.click(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(`${link}?via=copy`);

    await user.click(screen.getByRole("button", { name: "Take back" }));
    expect(api.withdrawChallenge).toHaveBeenCalledWith(ID);
    expect(await screen.findByRole("heading", { name: "Challenge taken back" })).toBeInTheDocument();
  });

  it("says so when the link cannot be copied", async () => {
    const { user } = openPage({ view: challenge({ own: true }) });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    await user.click(await screen.findByRole("button", { name: "Copy link" }));

    expect(await screen.findByText("Couldn't copy. Select the link and copy it")).toBeInTheDocument();
  });

  it("follows the server's pushes, so its creator sees the moment someone takes it", async () => {
    const { socket } = openPage({ view: challenge({ own: true }) });
    await screen.findByRole("heading", { name: "Your Chess challenge" });

    act(() => socket.push("challenge:updated", { challenge: challenge({ id: "c0000000000000000009" }) }));
    expect(screen.getByRole("heading", { name: "Your Chess challenge" })).toBeInTheDocument();
    act(() =>
      socket.push("challenge:updated", {
        challenge: challenge({
          own: true,
          state: "accepted",
          acceptedName: "Arjun",
          room: { code: "AB2CD3", gameId: "chess" },
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Challenge taken", level: 1 })).toBeInTheDocument();
    expect(
      screen.getAllByText("Arjun took your Chess challenge. They are waiting for you.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Go to the game" })).toHaveAttribute(
      "href",
      "/games/chess/rooms/AB2CD3",
    );
  });

  it("shows the one who took it the way to the game, and anyone else that it was taken", async () => {
    openPage({
      view: challenge({ state: "accepted", took: true, room: { code: "AB2CD3", gameId: "chess" } }),
    });
    expect(await screen.findByText(CHALLENGE_COPY.tookIt.en)).toBeInTheDocument();
  });

  it.each([
    [{ state: "accepted" }, "Challenge taken", CHALLENGE_COPY.taken.en],
    [{ state: "expired" }, "Challenge expired", CHALLENGE_COPY.expired.en],
    [{ state: "withdrawn" }, "Challenge taken back", CHALLENGE_COPY.withdrawn.en],
    [{ state: "declined" }, "Challenge over", CHALLENGE_COPY.over.en],
    [{ state: "declined", own: true, toName: "Arjun" }, "Challenge over", "Arjun can't play right now."],
  ])(
    "is honest about a challenge that is over (%o), with the way to play anyway",
    async (fields, title, text) => {
      openPage({ view: challenge({ ...fields, expiresAt: undefined }) });

      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Play Chess" })).toHaveAttribute("href", "/games/chess");
    },
  );

  it("names a game this build does not know as a game", async () => {
    openPage({ view: challenge({ gameId: "ludo" }) });

    expect(
      await screen.findByRole("heading", { name: "You've been challenged to a game" }),
    ).toBeInTheDocument();
  });

  it("says a link that leads nowhere may have expired, and offers a game", async () => {
    openPage({ view: notFound() });

    expect(await screen.findByRole("heading", { name: "Challenge not found" })).toBeInTheDocument();
    expect(screen.getByText(CHALLENGE_COPY.notFound.en)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pick a game" })).toHaveAttribute("href", "/");
  });

  it("offers Try again when the server could not be reached", async () => {
    const { user, api } = openPage({
      view: new AppRequestError({ code: "INTERNAL", message: "Server down" }),
    });

    expect(await screen.findByText("Server down")).toBeInTheDocument();
    api.getChallenge.mockResolvedValue(challenge());
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Accept and play" })).toBeInTheDocument();
  });

  // "tum", never "aap": the one shared test in src/copy.hinglish.test.js reads these lines (CC-351).
  it("has an English line under every Hinglish one", () => {
    const lines = Object.values(CHALLENGE_COPY).map((copy) =>
      typeof copy === "function" ? copy("Riya", "Chess") : copy,
    );

    expect(lines.every((copy) => copy.hi.length > 0 && copy.en.length > 0)).toBe(true);
  });
});
