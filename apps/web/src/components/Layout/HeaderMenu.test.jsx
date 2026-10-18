import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// The header's menu on a phone (CC-259). jsdom applies no CSS, so these tests check what the menu says and does:
// its state, where the focus goes and when it closes. The browser tests check that a phone shows one row.

const menuButton = () => within(screen.getByRole("banner")).getByRole("button", { name: "Menu" });
const panel = () => document.getElementById(menuButton().getAttribute("aria-controls"));

async function openMenu({ api = fakeApi(), path = "/" } = {}) {
  const user = userEvent.setup();
  const app = renderApp({ api, path });
  await within(screen.getByRole("banner")).findByRole("link", { name: "Log in" });
  await user.click(menuButton());
  return { user, ...app };
}

describe("the header menu (CC-259)", () => {
  it("is a closed disclosure button that controls the player's controls", async () => {
    renderApp();

    await within(screen.getByRole("banner")).findByRole("link", { name: "Log in" });
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(panel()).not.toHaveClass("open");
    for (const name of ["Log in", "Sign up"]) {
      expect(within(panel()).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(panel()).getByRole("button", { name: "Sound on" })).toBeInTheDocument();
    expect(within(panel()).getByRole("slider", { name: "Volume" })).toBeInTheDocument();
  });

  it("opens on a press and moves the focus to its first control", async () => {
    await openMenu();

    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    expect(panel()).toHaveClass("open");
    expect(within(panel()).getByRole("button", { name: "Sound on" })).toHaveFocus();
  });

  it("closes on a second press", async () => {
    const { user } = await openMenu();

    await user.click(menuButton());

    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and gives the focus back to its button", async () => {
    const { user } = await openMenu();

    await user.keyboard("{Escape}");

    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveFocus();
  });

  it("leaves an Escape to the sound settings dialog opened from it", async () => {
    const { user } = await openMenu();
    await user.click(within(panel()).getByRole("button", { name: "Sound settings" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
  });

  it("ignores other keys", async () => {
    const { user } = await openMenu();

    await user.keyboard("a");

    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
  });

  it("stays open while its own controls are used", async () => {
    const { user } = await openMenu();

    await user.click(within(panel()).getByRole("button", { name: "Sound on" }));

    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    expect(within(panel()).getByRole("button", { name: "Sound off" })).toBeInTheDocument();
  });

  it("closes when the page outside it is pressed", async () => {
    const { user } = await openMenu();

    await user.click(screen.getByRole("heading", { level: 1 }));

    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes once a link in it has opened another page", async () => {
    const { user, url } = await openMenu();

    await user.click(within(panel()).getByRole("link", { name: "Log in" }));

    expect(url()).toBe("/login");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("is still closed on coming Back to the page it was opened on", async () => {
    const { user, url, back } = await openMenu();
    await user.click(within(panel()).getByRole("link", { name: "Log in" }));

    back();

    expect(url()).toBe("/");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("announces who you are from outside the menu, which a phone hides while it is closed", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("button", { name: "Play as a guest" }));

    const announcement = await screen.findByText(`Playing as ${GUEST.displayName}, a guest.`);
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(panel()).not.toContainElement(announcement);
    expect(screen.getByRole("banner")).not.toContainElement(announcement);
  });

  it("names an account holder in the announcement", async () => {
    renderApp({
      api: fakeApi({ getSession: async () => ({ kind: "user", id: "user_1", displayName: "Riya" }) }),
    });

    expect(await screen.findByText("Signed in as Riya.")).toHaveAttribute("aria-live", "polite");
  });

  it("has a plain Menu button while there is no progress to save", async () => {
    renderApp();

    await within(screen.getByRole("banner")).findByRole("link", { name: "Log in" });
    expect(menuButton()).toHaveAccessibleName("Menu");
    expect(menuButton().querySelector(".menuDot")).toBeNull();
  });

  it("holds the player's name and level once they play", async () => {
    renderApp({ api: fakeApi({ getSession: async () => GUEST }) });

    expect(await within(panel()).findByText(GUEST.displayName)).toBeInTheDocument();
  });
});
