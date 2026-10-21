import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { installMatchMedia } from "../../testing/matchMedia.js";
import { findUsableButton, renderApp } from "../../testing/render.jsx";

// The header (CC-259, rebuilt in CC-324). jsdom applies no CSS, so these tests check what each layout holds and
// does: which controls are where, their state, where the focus goes and when things close. The width is the fake
// matchMedia's (testing/matchMedia.js). The browser tests check that nothing is wider than the screen.

const banner = () => screen.getByRole("banner");
const menuButton = () => within(banner()).getByRole("button", { name: "Menu" });
const panel = () => document.getElementById(menuButton().getAttribute("aria-controls"));
const USER = Object.freeze({ kind: "user", id: "user_1", displayName: "Riya_with_a_long_name" });

async function openMenu({ api = fakeApi(), path = "/" } = {}) {
  installMatchMedia({ width: 390 });
  const user = userEvent.setup();
  const app = renderApp({ api, path });
  await within(banner()).findByRole("link", { name: "Log in" });
  await user.click(menuButton());
  return { user, ...app };
}

describe("the compact header's menu, under 64rem (CC-259, CC-324)", () => {
  it("is a closed disclosure button that controls the player's controls", async () => {
    installMatchMedia({ width: 390 });
    renderApp();

    await within(banner()).findByRole("link", { name: "Log in" });
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(panel()).not.toHaveClass("open");
    for (const name of ["Log in", "Sign up", "Games", "Leaderboards"]) {
      expect(within(panel()).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(panel()).getByRole("button", { name: "Sound on" })).toBeInTheDocument();
    expect(within(panel()).getByRole("slider", { name: "Volume" })).toBeInTheDocument();
  });

  it("groups its rows into Play, You and Settings for a visitor, and adds Social for a player", async () => {
    installMatchMedia({ width: 390 });
    renderApp({ api: fakeApi({ getSession: async () => GUEST }) });

    await within(banner()).findByText(GUEST.displayName);
    const groups = within(panel())
      .getAllByRole("group")
      .map((group) => group.getAttribute("aria-labelledby"))
      .map((id) => document.getElementById(id).textContent);
    expect(groups).toEqual(["Play", "Social", "You", "Settings"]);
    const social = within(panel()).getByRole("group", { name: "Social" });
    expect(within(social).getByRole("link", { name: "Friends" })).toHaveAttribute("href", "/friends");
    const you = within(panel()).getByRole("group", { name: "You" });
    expect(within(you).getByRole("link", { name: "Profile" })).toBeInTheDocument();
  });

  it("keeps the game links in the row from 40rem, and the Play group leaves the menu", async () => {
    installMatchMedia({ width: 768 });
    renderApp();

    await within(banner()).findByRole("link", { name: "Log in" });
    const nav = within(banner()).getByRole("navigation", { name: "Main" });
    expect(panel()).not.toContainElement(nav);
    expect(within(nav).getByRole("link", { name: "Leaderboards" })).toBeInTheDocument();
    expect(within(panel()).queryByRole("group", { name: "Play" })).toBeNull();
  });

  it("opens on a press and moves the focus to its first control", async () => {
    await openMenu();

    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    expect(panel()).toHaveClass("open");
    expect(within(panel()).getByRole("link", { name: "Games" })).toHaveFocus();
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

  it("stays open when a click beside the sound settings dialog closes only the dialog", async () => {
    const { user } = await openMenu();
    await user.click(within(panel()).getByRole("button", { name: "Sound settings" }));

    await user.click(screen.getByRole("dialog").parentElement);

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

  it("goes away when a tablet turns to a wide screen, and the row takes its controls", async () => {
    const media = installMatchMedia({ width: 900 });
    const user = userEvent.setup();
    renderApp();
    await within(banner()).findByRole("link", { name: "Log in" });
    await user.click(menuButton());

    media.setWidth(1280);

    expect(await within(banner()).findByRole("button", { name: "Sound options" })).toBeInTheDocument();
    expect(within(banner()).queryByRole("button", { name: "Menu" })).toBeNull();
    expect(within(banner()).getAllByRole("link", { name: "Log in" })).toHaveLength(1);
  });

  it("announces who you are from outside the menu, which is hidden while it is closed", async () => {
    installMatchMedia({ width: 390 });
    const user = userEvent.setup();
    renderApp();
    await user.click(await findUsableButton("Play as a guest"));

    const announcement = await screen.findByText(`Playing as ${GUEST.displayName}, a guest.`);
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(panel()).not.toContainElement(announcement);
    expect(banner()).not.toContainElement(announcement);
  });

  it("names an account holder in the announcement", async () => {
    renderApp({
      api: fakeApi({ getSession: async () => ({ kind: "user", id: "user_1", displayName: "Riya" }) }),
    });

    expect(await screen.findByText("Signed in as Riya.")).toHaveAttribute("aria-live", "polite");
  });

  it("has a plain Menu button while there is no progress to save", async () => {
    installMatchMedia({ width: 390 });
    renderApp();

    await within(banner()).findByRole("link", { name: "Log in" });
    expect(menuButton()).toHaveAccessibleName("Menu");
    expect(menuButton().querySelector(".menuDot")).toBeNull();
  });

  it("holds the player's name and level once they play", async () => {
    installMatchMedia({ width: 390 });
    renderApp({ api: fakeApi({ getSession: async () => GUEST }) });

    expect(await within(panel()).findByText(GUEST.displayName)).toBeInTheDocument();
  });
});

describe("the wide header, from 64rem (CC-324)", () => {
  it("has no Menu button, and keeps the volume in the sound pill's panel until it is opened", async () => {
    const user = userEvent.setup();
    renderApp();
    await within(banner()).findByRole("link", { name: "Log in" });

    expect(within(banner()).queryByRole("button", { name: "Menu" })).toBeNull();
    expect(within(banner()).getByRole("button", { name: "Sound on" })).toBeInTheDocument();
    expect(within(banner()).queryByRole("slider", { name: "Volume" })).toBeNull();
    const more = within(banner()).getByRole("button", { name: "Sound options" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    await user.click(more);

    expect(more).toHaveAttribute("aria-expanded", "true");
    const popover = within(banner()).getByRole("region", { name: "Sound options" });
    expect(within(popover).getByRole("slider", { name: "Volume" })).toHaveFocus();
    expect(within(popover).getByRole("button", { name: "Sound settings" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();
    expect(within(banner()).queryByRole("slider", { name: "Volume" })).toBeNull();
  });

  it("puts an account's name on its account menu, in full, with Profile, Friends, Feedback and Log out inside", async () => {
    const user = userEvent.setup();
    renderApp({ api: fakeApi({ getSession: async () => USER }) });

    const account = await within(banner()).findByRole("button", { name: USER.displayName });
    expect(within(account).getByText(USER.displayName)).toHaveAttribute("title", USER.displayName);
    expect(account).toHaveAttribute("aria-expanded", "false");

    await user.click(account);

    const panelEl = document.getElementById(account.getAttribute("aria-controls"));
    expect(within(panelEl).getByRole("link", { name: "Profile" })).toHaveFocus();
    for (const name of ["Profile", "Friends"]) {
      expect(within(panelEl).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(panelEl).getByRole("button", { name: "Feedback" })).toBeInTheDocument();
    expect(within(panelEl).getByRole("button", { name: "Log out" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(account).toHaveAttribute("aria-expanded", "false");
    expect(account).toHaveFocus();
  });

  it("keeps Log in and Sign up in the row for a guest, beside their account menu, with no Log out", async () => {
    const user = userEvent.setup();
    renderApp({ api: fakeApi({ getSession: async () => GUEST }) });

    const account = await within(banner()).findByRole("button", { name: GUEST.displayName });
    expect(within(banner()).getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(within(banner()).getByRole("link", { name: "Sign up" })).toBeInTheDocument();
    await user.click(account);
    expect(within(banner()).queryByRole("button", { name: "Log out" })).toBeNull();
  });

  // The audit's bug 8: NavLink only matched /leaderboards/overall, so the weekly and game boards lit nothing.
  it.each(["/leaderboards/overall", "/leaderboards/weekly", "/leaderboards/chess"])(
    "marks Leaderboards as the current page on %s",
    async (path) => {
      renderApp({ path });

      const nav = await within(banner()).findByRole("navigation", { name: "Main" });
      expect(within(nav).getByRole("link", { name: "Leaderboards" })).toHaveAttribute("aria-current", "page");
      expect(within(nav).getByRole("link", { name: "Games" })).not.toHaveAttribute("aria-current");
    },
  );

  it("marks Leaderboards in the phone's menu too", async () => {
    installMatchMedia({ width: 390 });
    renderApp({ path: "/leaderboards/weekly" });

    await within(banner()).findByRole("link", { name: "Log in" });
    expect(within(panel()).getByRole("link", { name: "Leaderboards" })).toHaveAttribute("aria-current", "page");
  });
});
