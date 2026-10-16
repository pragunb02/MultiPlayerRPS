import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, GUEST } from "../testing/fakes.js";
import { renderApp } from "../testing/render.jsx";

describe("App", () => {
  it("shows the pitch and the game catalog", async () => {
    renderApp();

    expect(screen.getByRole("heading", { level: 1, name: /play the classics/i })).toBeInTheDocument();
    const games = await screen.findByRole("list");
    expect(
      within(games)
        .getAllByRole("listitem")
        .map((li) => within(li).getByRole("heading").textContent),
    ).toEqual(["Rock Paper Scissors", "Chess"]);
  });

  it("starts playing as a guest in one click", async () => {
    const user = userEvent.setup();
    const { api } = renderApp();

    await user.click(await screen.findByRole("button", { name: /play as a guest/i }));

    expect(api.startGuest).toHaveBeenCalledOnce();
    expect(await screen.findByText(`You're playing as ${GUEST.displayName}.`)).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText(GUEST.displayName)).toBeInTheDocument();
  });

  it("explains a failure to start a guest session", async () => {
    const user = userEvent.setup();
    renderApp({
      api: fakeApi({
        startGuest: async () => Promise.reject(new Error("Too many requests, try again later")),
      }),
    });

    await user.click(await screen.findByRole("button", { name: /play as a guest/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests, try again later");
  });

  it("explains when the catalog cannot load", async () => {
    renderApp({
      api: fakeApi({ getGames: async () => Promise.reject(new Error("Can't reach ClassiCade")) }),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach ClassiCade");
  });

  it("shows a not-found page for unknown URLs", async () => {
    renderApp({ path: "/nope" });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("offers a skip link to the main content (keyboard users)", () => {
    renderApp();

    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });
});
