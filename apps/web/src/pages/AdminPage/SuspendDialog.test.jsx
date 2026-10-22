import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-334, ADR-078: the owner suspends a reported account from its group in the report queue.

const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
const T0 = Date.UTC(2026, 9, 21, 6, 30);
const GROUP_ID = "00000000-0000-4000-d000-000000000002";

const group = (fields = {}) => ({
  groupId: GROUP_ID,
  kind: "account",
  canRename: true,
  canSuspend: true,
  names: ["RudeName"],
  reports: 1,
  reporters: 1,
  setAside: 0,
  reasons: { name: 0, cheating: 0, harassment: 1, other: 0 },
  lastAt: T0,
  items: [],
  ...fields,
});

const ownerApi = (overrides = {}) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    getReportQueue: vi.fn().mockResolvedValue({ groups: [group()], total: 1, page: 0, more: false }),
    ...overrides,
  });

async function openDialog(api = ownerApi()) {
  renderApp({ path: "/admin/reports", api });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Suspend" }));
  return { user, dialog: await screen.findByRole("dialog", { name: "Suspend RudeName?" }) };
}

afterEach(() => vi.restoreAllMocks());

describe("the suspend dialog (CC-334)", () => {
  it("offers the four durations and the closed reasons, and suspends after the owner confirms", async () => {
    const suspendAccount = vi.fn().mockResolvedValue({
      suspension: { suspensionId: "s-1", nameThen: "RudeName", duration: "7d", endsAt: T0 + 7 * 86_400_000 },
      closed: 1,
    });
    const api = ownerApi({ suspendAccount });
    const { user, dialog } = await openDialog(api);

    const durations = within(dialog).getAllByRole("radio");
    expect(durations.map((radio) => radio.labels[0].textContent)).toEqual([
      "24 hours",
      "7 days",
      "30 days",
      "Until I lift it",
    ]);
    expect(within(dialog).getByRole("radio", { name: "24 hours" })).toBeChecked();
    const reason = within(dialog).getByRole("combobox", { name: "Reason" });
    expect([...reason.options].map((option) => option.textContent)).toEqual([
      "Pick a reason",
      "Cheating or stalling",
      "Harassing other players",
      "Offensive name, again",
      "Another rule broken",
    ]);
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(dialog).toHaveTextContent(/signed out everywhere/i);
    expect(dialog).toHaveTextContent(/Nobody who reported is told/);

    // No reason picked yet: nothing is sent.
    await user.click(within(dialog).getByRole("button", { name: "Suspend RudeName" }));
    expect(suspendAccount).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Pick a reason first.");

    await user.click(within(dialog).getByRole("radio", { name: "7 days" }));
    await user.selectOptions(reason, "harassment");
    await user.click(within(dialog).getByRole("button", { name: "Suspend RudeName" }));

    expect(suspendAccount).toHaveBeenCalledWith(GROUP_ID, { duration: "7d", reason: "harassment" });
    expect(await screen.findByText(/RudeName is suspended until/)).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows why a suspension was refused, and keeps the dialog open", async () => {
    const suspendAccount = vi.fn().mockRejectedValue(
      new AppRequestError({
        code: "CONFLICT",
        message: "This account is suspended already. Lift it first",
        status: 409,
      }),
    );
    const { user, dialog } = await openDialog(ownerApi({ suspendAccount }));

    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Reason" }), "cheating");
    await user.click(within(dialog).getByRole("button", { name: "Suspend RudeName" }));

    expect(await within(dialog).findByText("This account is suspended already. Lift it first")).toBeVisible();
  });

  it("offers no Suspend for a guest's group", async () => {
    renderApp({
      path: "/admin/reports",
      api: ownerApi({
        getReportQueue: vi.fn().mockResolvedValue({
          groups: [group({ kind: "guest", canRename: false, canSuspend: false, names: ["Guest-ABCD"] })],
          total: 1,
          page: 0,
          more: false,
        }),
      }),
    });

    await screen.findByRole("heading", { name: "Guest-ABCD" });
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
  });
});
