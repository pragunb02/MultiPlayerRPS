import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FRIEND_LINK_MAKER_NAME } from "@classicade/shared";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-052, ADR-066.3: a "be my friend" link. Opening it shows who made it and never uses it up. An account's Add
// friend sends its maker a request. A guest or a visitor is shown how to save their progress first.
const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-";
const PATH = `/friends/add/${TOKEN}`;
const USER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Arjun" };
const gone = () =>
  new AppRequestError({ code: "NOT_FOUND", message: "This friend link has run out", status: 404 });

const linkApi = (invite, overrides = {}) =>
  fakeApi({
    getSession: vi.fn(async () => USER),
    getFriendLink: vi.fn().mockResolvedValue(invite),
    ...overrides,
  });

describe("the friend link page (CC-052)", () => {
  it("shows who made the link and sends them a request when the player adds them", async () => {
    const api = linkApi({ displayName: "Riya", avatar: "rocket" });
    renderApp({ path: PATH, api });

    expect(await screen.findByText("ClassiCade pe Riya ke friend bano.")).toBeVisible();
    expect(screen.getByText("Riya wants to be friends on ClassiCade.")).toBeVisible();
    expect(api.getFriendLink).toHaveBeenCalledWith(TOKEN);
    expect(api.useFriendLink).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Add friend" }));

    expect(api.useFriendLink).toHaveBeenCalledWith(TOKEN);
    expect(
      await screen.findByText("Request bhej di! Jab woh haan kahenge, tum friends ban jaoge."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "See your friends" })).toHaveAttribute("href", "/friends");
  });

  it("says when the two are friends already", async () => {
    renderApp({
      path: PATH,
      api: linkApi({ displayName: "Riya" }, { useFriendLink: vi.fn().mockResolvedValue("friends") }),
    });

    await userEvent.click(await screen.findByRole("button", { name: "Add friend" }));

    expect(await screen.findByText("Tum dono pehle se friends ho.")).toBeVisible();
  });

  it("names a maker the server hides as a ClassiCade player", async () => {
    renderApp({ path: PATH, api: linkApi({ displayName: FRIEND_LINK_MAKER_NAME }) });

    expect(
      await screen.findByText(`${FRIEND_LINK_MAKER_NAME} wants to be friends on ClassiCade.`),
    ).toBeVisible();
    expect(screen.getByText("Ek ClassiCade player ne tumhe friend banne ke liye bulaya hai.")).toBeVisible();
  });

  it("tells the maker it is their own link, with nothing to press", async () => {
    renderApp({ path: PATH, api: linkApi({ displayName: "Arjun", own: true }) });

    expect(await screen.findByText("Yeh tumhara apna friend link hai.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add friend" })).toBeNull();
  });

  it("shows a guest how to save their progress, and comes back to the link after", async () => {
    const api = linkApi({ displayName: "Riya" }, { getSession: vi.fn(async () => GUEST) });
    renderApp({ path: PATH, api });

    expect(await screen.findByText("Friends banane ke liye apni progress save karo.")).toBeVisible();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "Save progress" })).toHaveAttribute(
      "href",
      `/signup?next=${encodeURIComponent(PATH)}`,
    );
    expect(main.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(PATH)}`,
    );
    expect(main.queryByRole("button", { name: "Add friend" })).toBeNull();
  });

  it("says a link that ran out or was used is gone, and offers a game", async () => {
    renderApp({ path: PATH, api: linkApi(undefined, { getFriendLink: vi.fn().mockRejectedValue(gone()) }) });

    expect(await screen.findByText("Yeh link ab nahi chalta.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Play a game" })).toHaveAttribute("href", "/");
  });

  it("says when the link could not be opened for another reason", async () => {
    const down = new AppRequestError({ code: "UNKNOWN", message: "Server down", status: 500 });
    renderApp({ path: PATH, api: linkApi(undefined, { getFriendLink: vi.fn().mockRejectedValue(down) }) });

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open this friend link. Server down");
  });

  it("shows loading until the link's page arrives", async () => {
    renderApp({ path: PATH, api: linkApi(undefined, { getFriendLink: vi.fn(() => new Promise(() => {})) }) });

    expect(await screen.findByText("Loading…")).toBeVisible();
  });
});
