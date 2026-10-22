import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// A page that breaks while it draws (CC-350, CL-01). Here the home page gets a game list it cannot draw.
const brokenHome = () => fakeApi({ getGames: vi.fn().mockResolvedValue([null]) });

describe("a page that breaks", () => {
  let quiet;
  beforeEach(() => {
    quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => quiet.mockRestore());

  it("keeps the header, so the player can still go somewhere else", async () => {
    renderApp({ api: brokenHome() });

    expect(await screen.findByRole("heading", { level: 1, name: "This page broke" })).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Log in" })).toBeInTheDocument();
  });

  it("shows the next page normally once the player follows a link in the header", async () => {
    const user = userEvent.setup();
    renderApp({ api: brokenHome() });
    await screen.findByRole("heading", { level: 1, name: "This page broke" });

    await user.click(within(screen.getByRole("banner")).getByRole("link", { name: "Log in" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByText("This page broke")).not.toBeInTheDocument();
  });
});
