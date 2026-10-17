import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, fakeSocket, GUEST } from "../testing/fakes.js";
import { renderApp } from "../testing/render.jsx";

// Every screen has one URL; every other spelling of it ends there (ADR-011). Checked for visitors without a
// session, guests and signed-in users.
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const asVisitor = () => fakeApi();
const asGuest = () => fakeApi({ getSession: async () => GUEST });
const asUser = () => fakeApi({ getSession: async () => USER });

function roomSocket(room) {
  const socket = fakeSocket();
  socket.connect();
  socket.request.mockImplementation(async (event) => (event === "room:join" ? room : { left: true }));
  return socket;
}
const tictactoeRoom = {
  code: "AB2CD3",
  gameId: "tictactoe",
  status: "waiting",
  hostId: GUEST.id,
  players: { min: 2, max: 2 },
  seats: [{ playerId: GUEST.id, displayName: GUEST.displayName, connected: true }],
  you: GUEST.id,
};

describe("URLs: one per screen, each with its own title", () => {
  it.each([
    ["/", "ClassiCade"],
    ["/games/rock-paper-scissors", "Rock Paper Scissors · ClassiCade"],
    ["/games/tic-tac-toe", "Tic Tac Toe · ClassiCade"],
    ["/games/chess", "Chess · ClassiCade"],
    ["/login", "Log in · ClassiCade"],
    ["/signup", "Sign up · ClassiCade"],
    ["/profile", "Your profile · ClassiCade"],
    ["/nope", "Page not found · ClassiCade"],
  ])("%s", async (path, title) => {
    const { url } = renderApp({ path, api: asVisitor() });

    await waitFor(() => expect(document.title).toBe(title));
    expect(url()).toBe(path);
  });
});

describe("old and alternative URLs lead to the canonical one", () => {
  it.each([
    ["/play/rps", "/games/rock-paper-scissors"],
    ["/play/tictactoe", "/games/tic-tac-toe"],
    ["/play/chess", "/games/chess"],
    ["/games/rockpaperscissors", "/games/rock-paper-scissors"],
    ["/games/tictactoe", "/games/tic-tac-toe"],
    ["/games/Chess", "/games/chess"],
    ["/u/riya/userprofile", "/profile"],
    ["/login-signup.html", "/login"],
  ])("%s → %s", async (from, to) => {
    const { url } = renderApp({ path: from, api: asVisitor() });

    await waitFor(() => expect(url()).toBe(to));
  });

  it.each([
    ["/room/AB2CD3", "first app's invite links"],
    ["/room/ab2cd3", "lower-case code"],
    ["/games/tic-tac-toe/rooms/ab2cd3", "lower-case code"],
    ["/games/chess/rooms/AB2CD3", "the room belongs to another game"],
  ])("rooms: %s (%s) → /games/tic-tac-toe/rooms/AB2CD3", async (from) => {
    const { url } = renderApp({ path: from, api: asGuest(), socket: roomSocket(tictactoeRoom) });

    expect(await screen.findByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
    // The address is recorded after the screen is drawn (LocationProbe runs in an effect).
    await waitFor(() => expect(url()).toBe("/games/tic-tac-toe/rooms/AB2CD3"));
    expect(document.title).toBe("Tic Tac Toe · Room AB2CD3 · ClassiCade");
  });

  it("an unknown game is not found, and keeps its URL", () => {
    const { url } = renderApp({ path: "/games/ludo" });

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(url()).toBe("/games/ludo");
  });
});

describe("account pages and `next`", () => {
  it("a signed-in user opening log in or sign up goes where they were heading", async () => {
    const login = renderApp({ path: "/login?next=%2Fprofile", api: asUser() });
    await waitFor(() => expect(login.url()).toBe("/profile"));
    login.unmount();

    const signup = renderApp({ path: "/signup", api: asUser() });
    await waitFor(() => expect(signup.url()).toBe("/"));
  });

  it("guests and visitors see the form", async () => {
    renderApp({ path: "/login", api: asGuest() });
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("the header on an account page keeps `next` instead of nesting it", async () => {
    renderApp({ path: "/login?next=%2Fgames%2Fchess", api: asVisitor() });
    const banner = screen.getByRole("banner");

    expect(await within(banner).findByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login?next=%2Fgames%2Fchess",
    );
    expect(within(banner).getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup?next=%2Fgames%2Fchess",
    );
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/signup?next=%2Fgames%2Fchess",
    );
  });

  it("a `next` to another site or back to an account page goes home after login", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ login: async () => ({ identity: USER }), getGames: asVisitor().getGames });
    const { url } = renderApp({ path: "/login?next=%2Flogin%3Fnext%3D%252Fprofile", api });

    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(url()).toBe("/"));
  });

  it("logging in from a room returns to the room", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ login: async () => ({ identity: USER }) });
    const { url } = renderApp({
      path: "/login?next=%2Fgames%2Ftic-tac-toe%2Frooms%2FAB2CD3",
      api,
      socket: roomSocket({ ...tictactoeRoom, you: USER.id }),
    });

    await user.type(screen.getByLabelText("Email"), "riya@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Invite a friend" })).toBeInTheDocument();
    // The address is recorded after the screen is drawn (LocationProbe runs in an effect).
    await waitFor(() => expect(url()).toBe("/games/tic-tac-toe/rooms/AB2CD3"));
  });
});

describe("navigation", () => {
  it("marks Games as the current section in the catalog and inside a game", async () => {
    renderApp({ path: "/games/chess", api: asGuest() });

    expect(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Games" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("Profile is only offered to someone with a session", async () => {
    renderApp({ path: "/", api: asVisitor() });
    await screen.findByRole("link", { name: "Log in" });

    expect(
      within(screen.getByRole("navigation", { name: "Main" })).queryByRole("link", { name: "Profile" }),
    ).toBeNull();
  });
});
