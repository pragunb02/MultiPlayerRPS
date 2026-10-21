import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_TONES,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  FIELD_KINDS,
  NOTICE_TONES,
} from "../../components/looks.js";
import { BREAKPOINTS, LAYERS, PLAYER_ROLES, STATUS_ROLES, WEIGHTS } from "../../styles/tokenRoles.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { renderApp } from "../../testing/render.jsx";

// CC-314: the console's living design contract, behind the design_page flag.
const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
const PLAYER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };

const ownerApi = (on, overrides = {}) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    getFlags: vi.fn().mockResolvedValue({ design_page: on }),
    ...overrides,
  });

async function openDesign(api) {
  renderApp({ path: "/admin/design", api });
  await screen.findByRole("heading", { name: "Design", level: 1 });
  return userEvent.setup();
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("style");
});

describe("the console's design page (CC-314)", () => {
  it.each([
    ["a visitor", fakeApi()],
    ["a guest", fakeApi({ getSession: async () => GUEST })],
    ["an account that is not an admin", fakeApi({ getSession: async () => PLAYER })],
  ])("shows %s the ordinary not found page", async (_, api) => {
    renderApp({ path: "/admin/design", api });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Design" })).toBeNull();
  });

  it("is a tab of the console, with its own title", async () => {
    await openDesign(ownerApi(false));

    expect(document.title).toBe("Design · Owner console · ClassiCade");
    expect(screen.getByRole("link", { name: "Design" })).toHaveAttribute("aria-current", "page");
  });
});

flagPaths("design_page", (on) => {
  it(`${on ? "draws every token and component of the contract" : "says the page is behind its flag"}`, async () => {
    const api = ownerApi(on);
    const user = await openDesign(api);

    if (!on) {
      expect(await screen.findByText(/behind the design_page flag/)).toBeVisible();
      const note = screen.getByText(/behind the design_page flag/);
      expect(within(note).getByRole("link", { name: "Flags" })).toHaveAttribute("href", "/admin/flags");
      expect(screen.queryByRole("heading", { name: "Colour roles" })).toBeNull();
      return;
    }
    await screen.findByRole("heading", { name: "Colour roles" });
    expect(screen.getByText(/Shown in the light theme/)).toBeVisible();
    for (const { role } of [...STATUS_ROLES, ...PLAYER_ROLES]) {
      expect(screen.getByText(`--color-${role}`, { selector: "th > code" })).toBeVisible();
    }
    for (const { token } of [...LAYERS, ...BREAKPOINTS]) {
      expect(screen.getByText(token, { selector: "th > code" })).toBeVisible();
    }
    for (const { token } of WEIGHTS) {
      expect(screen.getByText(token, { selector: "li > code" })).toBeVisible();
    }
    const components = [...document.querySelectorAll("[data-cc-component]")].map((part) =>
      part.getAttribute("data-cc-component"),
    );
    expect(components).toEqual([
      "button",
      "dialog",
      "toast",
      "banner",
      "card",
      "badge",
      "empty state",
      "error state",
      "skeleton",
      "field",
      "tabs",
      "section",
    ]);
    expect(screen.getByText("Your turn")).toHaveAttribute("data-turn", "you");
    expect(screen.getByText("Waiting for Guest-ABCD")).toHaveAttribute("data-turn", "opponent");

    await user.click(screen.getByRole("button", { name: "Open a dialog" }));
    const dialog = screen.getByRole("dialog", { name: "Block Riya?" });
    expect(api.sendFlagSuccess).toHaveBeenCalledWith("design_page");
    await user.click(within(dialog).getByRole("button", { name: "Block" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open a dialog" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open a dialog" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show a toast" }));
    expect(await screen.findByText("Saved. This is a toast.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Press to see failed" }));
    expect(await screen.findByText("The server did not answer.")).toBeInTheDocument();
  });
});

describe("the design page's states", () => {
  it("shows every new component in every state (CC-323 AC-17)", async () => {
    const user = await openDesign(ownerApi(true));
    await screen.findByRole("heading", { name: "Colour roles" });
    const part = (name) => document.querySelector(`[data-cc-component="${name}"]`);

    // Button: every look in every size, each with its cannot-act reason, then loading, link and icon forms.
    const rows = [...part("button").querySelectorAll("[data-cc-variant-row]")];
    expect(rows.map((row) => row.getAttribute("data-cc-variant-row"))).toEqual(BUTTON_VARIANTS);
    for (const row of rows) {
      expect(within(row).getAllByRole("button", { name: "Play now" })).toHaveLength(BUTTON_SIZES.length);
      expect(within(row).getByRole("button", { name: "Resign" })).toHaveAttribute("aria-disabled", "true");
    }
    const loading = part("button").querySelector('[data-cc-control="admin.design.loading"]');
    await waitFor(() => expect(loading).toHaveAttribute("aria-busy", "true"), { timeout: 1_000 });
    expect(within(part("button")).getByRole("link", { name: "A link drawn as a button" })).toHaveAttribute(
      "href",
      "/admin/design",
    );
    expect(within(part("button")).getByRole("button", { name: "Next round" })).toHaveClass("iconOnly");

    // Card: interactive with media and its one link, surface, raised, selected, cannot act, every tone.
    const card = part("card");
    expect(within(card).getByRole("link", { name: "Chess" })).toBeInTheDocument();
    for (const variant of ["surface", "raised", "accent", "notice"]) {
      expect(card.querySelector(`[data-cc-card="${variant}"]`)).not.toBeNull();
    }
    expect(card.querySelector("[data-selected='true']")).not.toBeNull();
    expect(within(card).getByText("Sign in to play ranked.")).toBeInTheDocument();
    expect(card.querySelectorAll('[data-cc-card="accent"]')).toHaveLength(ACCENT_TONES.length + 1);
    expect(card.querySelectorAll('[data-cc-card="notice"]')).toHaveLength(NOTICE_TONES.length);

    // Empty, error and loading.
    expect(within(part("empty state")).getByRole("heading", { name: "No friends yet" })).toBeInTheDocument();
    expect(within(part("error state")).getByRole("alert")).toHaveTextContent(
      "Couldn't load the leaderboard.",
    );
    await user.click(within(part("error state")).getByRole("button", { name: "Retry" }));
    expect(within(part("error state")).getByRole("alert")).toBeInTheDocument();
    expect(within(part("skeleton")).getAllByRole("status").length).toBeGreaterThanOrEqual(4);

    // Fields: every kind, with hint, error, count, disabled and copy.
    const kinds = [...part("field").querySelectorAll("[data-cc-field]")].map((field) =>
      field.getAttribute("data-cc-field"),
    );
    for (const kind of FIELD_KINDS) expect(kinds).toContain(kind);
    expect(within(part("field")).getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(within(part("field")).getByText("0 of 500 characters")).toBeInTheDocument();
    expect(within(part("field")).getByLabelText("Room code")).toBeDisabled();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await user.click(within(part("field")).getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();

    // Tabs, and the sections with a header row and a word beside each colour.
    const tabs = within(part("tabs")).getByRole("navigation", { name: "Example boards" });
    expect(within(tabs).getByRole("link", { name: "Overall" })).toHaveAttribute("aria-current", "page");
    const section = part("section");
    expect(within(section).getByRole("region", { name: "Games played" })).toHaveTextContent(
      "Finished games, last 7 days, India time.",
    );
    expect(
      within(section)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Game", "Games", "Change"]);
    expect(within(section).getByText("▲ 12% up")).toBeInTheDocument();
    expect(within(section).getByRole("heading", { name: "Nothing new" })).toBeInTheDocument();
  });

  it("shows the waiting state of a button and then its done label", async () => {
    const user = await openDesign(ownerApi(true));
    await screen.findByRole("heading", { name: "Colour roles" });
    const button = document.querySelector('[data-cc-control="admin.design.waiting"]');
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"), { timeout: 1_000 });
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"), { timeout: 2_000 });
    expect(within(button).getByText("Sent")).toBeInTheDocument();
  });

  it("still opens the dialog when the flag's success count cannot be sent", async () => {
    const user = await openDesign(
      ownerApi(true, { sendFlagSuccess: vi.fn().mockRejectedValue(new Error("offline")) }),
    );
    await user.click(await screen.findByRole("button", { name: "Open a dialog" }));
    expect(screen.getByRole("dialog", { name: "Block Riya?" })).toBeVisible();
  });

  it("measures contrast with the browser's values, and names the dark theme when the device is dark", async () => {
    document.documentElement.style.setProperty("--color-success", "#13795b");
    document.documentElement.style.setProperty("--color-bg", "#f4f3ff");
    const light = window.matchMedia;
    window.matchMedia = (query) => ({ ...light(query), matches: query === "(prefers-color-scheme: dark)" });
    try {
      await openDesign(ownerApi(true));
      await screen.findByRole("heading", { name: "Colour roles" });

      expect(screen.getByText(/Shown in the dark theme/)).toBeVisible();
      const success = document.querySelector('[data-cc-role="success"]');
      expect(within(success).getByText("4.9:1")).toBeInTheDocument();
      expect(within(success).getAllByText("–").length).toBeGreaterThan(0);
    } finally {
      window.matchMedia = light;
    }
  });
});
