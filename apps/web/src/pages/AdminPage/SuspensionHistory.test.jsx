import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-334, ADR-078: the history of one reported player's suspensions, and the suspensions in effect now, with Lift.

const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
const T0 = Date.UTC(2026, 9, 21, 6, 30);
const DAY = 86_400_000;
const GROUP_ID = "00000000-0000-4000-d000-000000000002";

const current = {
  suspensionId: "00000000-0000-4000-c000-000000000002",
  nameThen: "RudeName",
  duration: "until-lifted",
  reason: "harassment",
  startedAt: T0,
  byName: "Site_Owner",
  active: true,
};
const earlier = {
  suspensionId: "00000000-0000-4000-c000-000000000001",
  nameThen: "RudeName",
  duration: "24h",
  reason: "name",
  startedAt: T0 - 10 * DAY,
  endsAt: T0 - 9 * DAY,
  byName: "Site_Owner",
  liftedAt: T0 - 9.5 * DAY,
  liftedByName: "Site_Owner",
  active: false,
};

const ownerApi = (overrides = {}) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    getReportQueue: vi.fn().mockResolvedValue({
      groups: [
        {
          groupId: GROUP_ID,
          kind: "account",
          canRename: false,
          canSuspend: true,
          names: ["RudeName"],
          reports: 1,
          reporters: 1,
          setAside: 0,
          reasons: { name: 0, cheating: 0, harassment: 1, other: 0 },
          lastAt: T0,
          items: [],
        },
      ],
      total: 1,
      page: 0,
      more: false,
    }),
    getSuspensionHistory: vi.fn().mockResolvedValue([current, earlier]),
    getCurrentSuspensions: vi.fn().mockResolvedValue([current]),
    ...overrides,
  });

afterEach(() => vi.restoreAllMocks());

describe("suspension history and the current suspensions (CC-334)", () => {
  it("lists each suspension with who acted and when, and lifts the current one", async () => {
    const liftSuspension = vi.fn().mockResolvedValue({ ...current, active: false, liftedAt: T0 + DAY });
    const api = ownerApi({ liftSuspension });
    renderApp({ path: "/admin/reports", api });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "History" }));

    const history = await screen.findByRole("list", { name: "Suspensions of RudeName" });
    const rows = within(history).getAllByRole("listitem");
    expect(api.getSuspensionHistory).toHaveBeenCalledWith(GROUP_ID);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Until I lift it");
    expect(rows[0]).toHaveTextContent("Harassing other players");
    expect(rows[0]).toHaveTextContent("by Site_Owner");
    expect(rows[0]).toHaveTextContent("In effect");
    expect(rows[1]).toHaveTextContent("24 hours");
    expect(rows[1]).toHaveTextContent("Offensive name, again");
    expect(rows[1]).toHaveTextContent(/Lifted .* by Site_Owner/);
    // Only the one in effect can be lifted.
    expect(within(rows[1]).queryByRole("button", { name: /Lift/ })).toBeNull();

    // The list of current suspensions, for one whose reports are long gone.
    const now = await screen.findByRole("list", { name: "Suspended now" });
    await user.click(within(now).getByRole("button", { name: "Lift RudeName's suspension" }));
    await user.click(await screen.findByRole("button", { name: "Lift the suspension" }));

    expect(liftSuspension).toHaveBeenCalledWith(current.suspensionId);
    expect(await screen.findByText("RudeName's suspension is lifted.")).toBeVisible();
  });

  it("says when nobody is suspended", async () => {
    renderApp({
      path: "/admin/reports",
      api: ownerApi({ getCurrentSuspensions: vi.fn().mockResolvedValue([]) }),
    });

    expect(await screen.findByText("Nobody is suspended now.")).toBeVisible();
  });
});
