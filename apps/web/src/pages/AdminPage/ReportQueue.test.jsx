import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

// CC-044, ADR-071: the owner's report queue in the console. One group per reported player, never an id.

const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
const T0 = Date.UTC(2026, 9, 20, 6, 30);

const group = (fields = {}) => ({
  groupId: "00000000-0000-4000-d000-000000000002",
  kind: "account",
  canRename: true,
  names: ["RudeName"],
  reports: 2,
  reporters: 2,
  setAside: 0,
  reasons: { name: 1, cheating: 1, harassment: 0, other: 0 },
  lastAt: T0,
  items: [
    {
      reportId: "00000000-0000-4000-d000-000000000002",
      reason: "cheating",
      nameThen: "RudeName",
      context: {
        kind: "match",
        gameId: "chess",
        matchId: "11111111-2222-4333-8444-555555555555",
        recent: [{ by: "reported", kind: "move", text: '"e4"', at: T0 - 1000 }],
      },
      setAside: false,
      createdAt: T0,
    },
    {
      reportId: "00000000-0000-4000-d000-000000000001",
      reason: "name",
      note: "<img src=x onerror=alert(1)>",
      nameThen: "RudeName",
      context: { kind: "room", gameId: "rps", roomCode: "ABC234", recent: [] },
      setAside: false,
      createdAt: T0 - 60_000,
    },
  ],
  ...fields,
});

/** One page of the queue, as the server answers it: the groups, how many there are, and whether more follow. */
const page = (groups, { total = groups.length, page: number = 0, more = false } = {}) => ({
  groups,
  total,
  page: number,
  more,
});

const ownerApi = (overrides = {}) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    getReportQueue: vi.fn().mockResolvedValue(page([group()])),
    ...overrides,
  });

async function openQueue({ path = "/admin/reports", api = ownerApi() } = {}) {
  const view = renderApp({ path, api });
  await screen.findByRole("heading", { level: 1, name: "Reports" });
  return { user: userEvent.setup(), ...view };
}

afterEach(() => vi.restoreAllMocks());

describe("the report queue (CC-044)", () => {
  it.each([
    ["a visitor", fakeApi()],
    ["a guest", fakeApi({ getSession: async () => GUEST, getAdminStatus: vi.fn().mockResolvedValue(false) })],
  ])("is the ordinary not found page for %s, and never asks for the queue", async (_, api) => {
    renderApp({ path: "/admin/reports", api });

    expect(await screen.findByRole("heading", { name: /not found/i })).toBeVisible();
    expect(api.getReportQueue).not.toHaveBeenCalled();
  });

  it("shows one group per reported player with counts by reason, and each report's context, as plain text", async () => {
    const { api } = await openQueue();

    expect(document.title).toBe("Reports · Owner console · ClassiCade");
    expect(api.getReportQueue).toHaveBeenCalledWith({});
    const [entry] = await screen.findAllByRole("article");
    expect(within(entry).getByRole("heading", { name: "RudeName" })).toBeVisible();
    expect(entry).toHaveTextContent("2 reports from 2 people");
    const reasons = within(entry.querySelector('dl[aria-label="Reasons"]'));
    expect(reasons.getByText("Offensive name").nextSibling).toHaveTextContent("1");
    expect(reasons.getByText("Cheating or stalling").nextSibling).toHaveTextContent("1");
    expect(reasons.getByText("Something else").nextSibling).toHaveTextContent("0");
    expect(entry).toHaveTextContent("Room ABC234 · rps");
    expect(entry).toHaveTextContent("Match 11111111-2222-4333-8444-555555555555 · chess");
    expect(entry).toHaveTextContent('reported moved "e4"');
    // Reports carry no free text (owner, 2026-10-21): even a note in an answer is never shown, as text or markup.
    expect(within(entry).queryByText("<img src=x onerror=alert(1)>")).toBeNull();
    expect(entry.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  });

  it("dismisses a group's reports and takes it off the open list", async () => {
    const api = ownerApi({ actOnReports: vi.fn().mockResolvedValue({ closed: 2 }) });
    const { user } = await openQueue({ api });
    const [entry] = await screen.findAllByRole("article");

    await user.click(within(entry).getByRole("button", { name: "Dismiss" }));

    expect(api.actOnReports).toHaveBeenCalledWith("00000000-0000-4000-d000-000000000002", "dismiss");
    expect(await screen.findByText("Dismissed 2 reports about RudeName.")).toBeVisible();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("renames an account to the safe default after the owner says yes", async () => {
    const api = ownerApi({
      actOnReports: vi.fn().mockResolvedValue({ closed: 2, displayName: "Player_ABCDEF" }),
    });
    const { user } = await openQueue({ api });
    const [entry] = await screen.findAllByRole("article");

    await user.click(within(entry).getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename RudeName?" });
    await user.click(within(dialog).getByRole("button", { name: "Rename to a safe name" }));

    expect(api.actOnReports).toHaveBeenCalledWith("00000000-0000-4000-d000-000000000002", "rename");
    expect(await screen.findByText("RudeName is now Player_ABCDEF.")).toBeVisible();
  });

  it("offers no rename for a guest, whose name the server gave, and shows set aside reports", async () => {
    await openQueue({
      api: ownerApi({
        getReportQueue: vi
          .fn()
          .mockResolvedValue(page([group({ kind: "guest", canRename: false, setAside: 1, reporters: 1 })])),
      }),
    });
    const [entry] = await screen.findAllByRole("article");

    expect(within(entry).queryByRole("button", { name: "Rename" })).toBeNull();
    expect(entry).toHaveTextContent("1 set aside");
  });

  it("reads another status from the address, without actions on closed reports", async () => {
    const api = ownerApi({
      getReportQueue: vi.fn().mockResolvedValue(page([group({ canRename: false })])),
    });
    const { user } = await openQueue({ path: "/admin/reports?status=dismissed", api });

    expect(api.getReportQueue).toHaveBeenCalledWith({ status: "dismissed" });
    const [entry] = await screen.findAllByRole("article");
    expect(within(entry).queryByRole("button", { name: "Dismiss" })).toBeNull();
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "open");
    expect(api.getReportQueue).toHaveBeenLastCalledWith({});
  });

  it("shows the ordinary not found page when the server says the console is not there", async () => {
    renderApp({
      path: "/admin/reports",
      api: ownerApi({
        getReportQueue: vi
          .fn()
          .mockRejectedValue(new AppRequestError({ code: "NOT_FOUND", message: "Not found", status: 404 })),
      }),
    });

    expect(await screen.findByRole("heading", { name: /not found/i })).toBeVisible();
  });
});

describe("the report queue's other states (CC-044)", () => {
  it("names a profile report as such, shows requests as asked, and says when there are none left", async () => {
    const profileReport = group({
      items: [
        {
          reportId: "00000000-0000-4000-d000-000000000009",
          reason: "harassment",
          nameThen: "RudeName",
          context: { kind: "profile" },
          setAside: true,
          createdAt: T0,
        },
        {
          reportId: "00000000-0000-4000-d000-000000000008",
          reason: "harassment",
          nameThen: "RudeName",
          context: {
            kind: "room",
            gameId: "rps",
            roomCode: "ABC234",
            recent: [{ by: "reported", kind: "request", text: "rematch open", at: T0 }],
          },
          setAside: false,
          createdAt: T0 - 1,
        },
      ],
    });
    await openQueue({ api: ownerApi({ getReportQueue: vi.fn().mockResolvedValue(page([profileReport])) }) });
    const [entry] = await screen.findAllByRole("article");

    expect(entry).toHaveTextContent("Profile");
    expect(entry).toHaveTextContent("reported asked rematch open");
    expect(within(entry).getAllByText("set aside")).toHaveLength(1);
  });

  it("says there is nothing to read", async () => {
    await openQueue({ api: ownerApi({ getReportQueue: vi.fn().mockResolvedValue(page([])) }) });

    expect(await screen.findByText("No reports here.")).toBeVisible();
  });

  it("keeps the reports when the owner cancels a rename", async () => {
    const api = ownerApi({ actOnReports: vi.fn() });
    const { user } = await openQueue({ api });
    const [entry] = await screen.findAllByRole("article");

    await user.click(within(entry).getByRole("button", { name: "Rename" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await user.click(within(entry).getByRole("button", { name: "Rename" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.actOnReports).not.toHaveBeenCalled();
  });

  it("offers to try again after a failure that may pass", async () => {
    const getReportQueue = vi
      .fn()
      .mockRejectedValueOnce(
        new AppRequestError({ code: "NETWORK", message: "The network failed", status: 0 }),
      )
      .mockResolvedValue(page([group()]));
    renderApp({ path: "/admin/reports", api: ownerApi({ getReportQueue }) });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The network failed");
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(await screen.findAllByRole("article")).toHaveLength(1);
  });
});

describe("the report queue's pages (review of #150)", () => {
  it("says how many players were reported, and offers the next page when the list is cut off", async () => {
    const getReportQueue = vi
      .fn()
      .mockResolvedValueOnce(page([group()], { total: 30, more: true }))
      .mockResolvedValue(
        page([group({ groupId: "00000000-0000-4000-d000-000000000099" })], { total: 30, page: 1 }),
      );
    const { user } = await openQueue({ api: ownerApi({ getReportQueue }) });

    expect(await screen.findByText("Players 1 to 1 of 30 reported.")).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Next page" }));

    expect(getReportQueue).toHaveBeenLastCalledWith({ page: "1" });
    expect(await screen.findByText("Players 26 to 26 of 30 reported.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/admin/reports");
    expect(screen.queryByRole("link", { name: "Next page" })).toBeNull();
  });
});
