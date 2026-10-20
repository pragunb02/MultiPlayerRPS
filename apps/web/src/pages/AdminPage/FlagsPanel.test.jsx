import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { renderApp } from "../../testing/render.jsx";
import { rolloutText } from "./flagText.js";

// CC-312: the owner's feature flags in the console.
const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
const PLAYER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const T0 = Date.UTC(2026, 9, 20, 6, 30);

const flag = (fields = {}) => ({
  name: "new_lobby",
  description: "The new lobby layout.",
  ticket: "CC-400",
  audience: "signed-in",
  removeBy: "2026-12-31",
  overdue: false,
  client: true,
  success: "A room is made from the new lobby.",
  codeRollout: "off",
  rollout: "off",
  counts: { on: { exposures: 0, successes: 0 }, off: { exposures: 1234, successes: "<5" } },
  ...fields,
});
const view = (flags = [flag()], fields = {}) => ({
  source: "database",
  days: 30,
  countsRead: true,
  flags,
  ...fields,
});

const ownerApi = (overrides = {}) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    getAdminFlags: vi.fn().mockResolvedValue(view()),
    ...overrides,
  });

/** Opens the page as the owner and waits for the list, unless the test expects it to fail first. */
async function openFlags(api = ownerApi(), { listed = true } = {}) {
  const rendered = renderApp({ path: "/admin/flags", api });
  await screen.findByRole("heading", { name: "Flags", level: 1 });
  if (listed) await screen.findAllByRole("article");
  return { user: userEvent.setup(), ...rendered };
}

const card = (name) => screen.getByRole("article", { name });

afterEach(() => vi.restoreAllMocks());

describe("the console's flags (CC-312)", () => {
  it.each([
    ["a visitor", fakeApi()],
    ["a guest", fakeApi({ getSession: async () => GUEST })],
    ["an account that is not an admin", fakeApi({ getSession: async () => PLAYER })],
  ])("shows %s the ordinary not found page, without asking for any flags", async (_, api) => {
    renderApp({ path: "/admin/flags", api });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(api.getAdminFlags).not.toHaveBeenCalled();
  });

  it("shows the not found page when the server will not say it has flags", async () => {
    const api = ownerApi({
      getAdminFlags: vi
        .fn()
        .mockRejectedValue(new AppRequestError({ code: "NOT_FOUND", message: "x", status: 404 })),
    });
    renderApp({ path: "/admin/flags", api });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  it("lists each flag with its facts, rollouts and anonymous counts, under its own tab", async () => {
    await openFlags(
      ownerApi({
        getAdminFlags: vi.fn().mockResolvedValue(
          view([
            flag(),
            flag({
              name: "old_flag",
              overdue: true,
              audience: "adults",
              rollout: 30,
              override: { rollout: 30, updatedAt: T0 },
            }),
          ]),
        ),
      }),
    );

    expect(document.title).toBe("Flags · Owner console · ClassiCade");
    expect(screen.getByRole("link", { name: "Flags" })).toHaveAttribute("aria-current", "page");
    const lobby = card("new_lobby");
    expect(within(lobby).getByText("The new lobby layout.")).toBeVisible();
    expect(within(lobby).getByText("Players with an account")).toBeVisible();
    expect(within(lobby).getByText("CC-400")).toBeVisible();
    const offRow = within(lobby).getByRole("row", { name: /Flag off/ });
    expect(offRow).toHaveTextContent("1,234");
    expect(offRow).toHaveTextContent("fewer than 5");
    expect(within(lobby).queryByText("Past its removal date")).toBeNull();
    expect(within(lobby).queryByRole("button", { name: "Use the rollout in code" })).toBeNull();

    const old = card("old_flag");
    expect(within(old).getByText("Past its removal date")).toBeVisible();
    expect(within(old).getByText("Adults with an account")).toBeVisible();
    expect(within(old).getByText(/30% of the audience \(set /)).toBeVisible();
  });

  it("sets a share of the audience, then on, then goes back to the rollout in code", async () => {
    const api = ownerApi({
      setFlagRollout: vi.fn(async (name, rollout) => flag({ rollout, override: { rollout, updatedAt: T0 } })),
      clearFlagRollout: vi.fn(async () => flag()),
    });
    const { user } = await openFlags(api);

    await user.selectOptions(within(card("new_lobby")).getByLabelText("Rollout"), "share");
    const percent = within(card("new_lobby")).getByLabelText("Percentage");
    await user.clear(percent);
    await user.type(percent, "25");
    await user.click(within(card("new_lobby")).getByRole("button", { name: "Save" }));
    expect(await within(card("new_lobby")).findByText(/25% of the audience \(set /)).toBeVisible();
    expect(api.setFlagRollout).toHaveBeenLastCalledWith("new_lobby", 25);

    await user.selectOptions(within(card("new_lobby")).getByLabelText("Rollout"), "on");
    await user.click(within(card("new_lobby")).getByRole("button", { name: "Save" }));
    expect(api.setFlagRollout).toHaveBeenLastCalledWith("new_lobby", "on");

    await user.click(
      await within(card("new_lobby")).findByRole("button", { name: "Use the rollout in code" }),
    );
    expect(api.clearFlagRollout).toHaveBeenCalledWith("new_lobby");
    await waitFor(() =>
      expect(within(card("new_lobby")).queryByRole("button", { name: "Use the rollout in code" })).toBeNull(),
    );
    expect(within(card("new_lobby")).queryByText(/\(set /)).toBeNull();
    expect(within(card("new_lobby")).getAllByText("Off", { selector: "dd" })).toHaveLength(2);
  });

  it.each([["101"], ["2.5"], [""]])("refuses the percentage %j before asking the server", async (typed) => {
    const api = ownerApi({ setFlagRollout: vi.fn() });
    const { user } = await openFlags(api);

    await user.selectOptions(within(card("new_lobby")).getByLabelText("Rollout"), "share");
    const percent = within(card("new_lobby")).getByLabelText("Percentage");
    await user.clear(percent);
    if (typed !== "") await user.type(percent, typed);
    await user.click(within(card("new_lobby")).getByRole("button", { name: "Save" }));

    expect(within(card("new_lobby")).getByRole("alert")).toHaveTextContent(
      "Write a whole number from 0 to 100.",
    );
    expect(percent).toHaveAttribute("aria-invalid", "true");
    expect(api.setFlagRollout).not.toHaveBeenCalled();
  });

  it("says when the database could not be read and every flag uses its rollout in code", async () => {
    await openFlags(
      ownerApi({
        getAdminFlags: vi.fn().mockResolvedValue(view([flag()], { source: "code", countsRead: false })),
      }),
    );

    expect(screen.getByText(/every flag uses its rollout in code/)).toBeVisible();
    expect(screen.getByText(/stored counts could not be read/)).toBeVisible();
  });

  it("shows a failure with Try again, and loads on a second try", async () => {
    const getAdminFlags = vi
      .fn()
      .mockRejectedValueOnce(
        new AppRequestError({ code: "NETWORK", message: "Can't reach the server", status: 0 }),
      )
      .mockResolvedValue(view());
    const { user } = await openFlags(ownerApi({ getAdminFlags }), { listed: false });

    expect(await screen.findByText("Can't reach the server")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("article", { name: "new_lobby" })).toBeVisible();
  });

  it("writes each rollout in words", () => {
    expect([rolloutText("off"), rolloutText("on"), rolloutText(5)]).toEqual([
      "Off",
      "On",
      "5% of the audience",
    ]);
  });
});

flagPaths("console_flag_check", (on) => {
  it(`${on ? "shows" : "hides"} the line that says the flag reaches the owner, and its button counts a success`, async () => {
    const api = ownerApi({ getFlags: vi.fn().mockResolvedValue({ console_flag_check: on }) });
    const { user } = await openFlags(api);
    await screen.findByRole("article", { name: "new_lobby" });

    expect(api.getFlags).toHaveBeenCalledWith(["console_flag_check"]);
    const line = screen.queryByText(/The console_flag_check flag is on for you/);
    if (!on) {
      expect(line).toBeNull();
      expect(screen.queryByRole("button", { name: "It works" })).toBeNull();
      return;
    }
    expect(line).toBeVisible();
    await user.click(screen.getByRole("button", { name: "It works" }));
    expect(api.sendFlagSuccess).toHaveBeenCalledWith("console_flag_check");
  });
});
