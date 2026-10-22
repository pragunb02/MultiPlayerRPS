import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import REPORT from "../../testing/analyticsReport.json";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { renderApp } from "../../testing/render.jsx";

const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
const PLAYER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
const WEEK = "from=2025-03-03&to=2025-03-09&bucket=day";

const ownerApi = (overrides = {}) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    getAnalytics: vi.fn().mockResolvedValue(REPORT),
    ...overrides,
  });

const openConsole = async (path = `/admin?${WEEK}`, api = ownerApi()) => {
  const view = renderApp({ path, api });
  await screen.findByRole("heading", { name: "Owner console" });
  await screen.findByRole("button", { name: "Show" });
  return view;
};

const tile = (label) => screen.getByText(label, { selector: "dt" }).parentElement;

afterEach(() => vi.restoreAllMocks());

describe("owner console access (CC-233)", () => {
  it.each([
    ["a visitor", fakeApi()],
    ["a guest", fakeApi({ getSession: async () => GUEST })],
    ["an account that is not an admin", fakeApi({ getSession: async () => PLAYER })],
    [
      "an account whose admin check failed",
      fakeApi({
        getSession: async () => PLAYER,
        getAdminStatus: vi.fn().mockRejectedValue(new Error("down")),
      }),
    ],
  ])("shows %s the ordinary not found page, without asking for any numbers", async (_, api) => {
    renderApp({ path: "/admin/players", api });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(api.getAnalytics).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Console" })).toBeNull();
  });

  it("never asks the server about guests and visitors", async () => {
    const api = fakeApi({ getSession: async () => GUEST });
    renderApp({ path: "/", api });
    await screen.findAllByRole("link", { name: /ClassiCade home/ });

    expect(api.getAdminStatus).not.toHaveBeenCalled();
  });

  it("links the console in the header for an admin only", async () => {
    renderApp({ path: "/", api: ownerApi() });

    const link = await screen.findByRole("link", { name: "Console" });
    expect(link).toHaveAttribute("href", "/admin");
  });

  it("shows not found when the server stops treating the owner as an admin", async () => {
    const api = ownerApi({
      getAnalytics: vi
        .fn()
        .mockRejectedValue(new AppRequestError({ code: "NOT_FOUND", message: "Not found", status: 404 })),
    });
    renderApp({ path: "/admin", api });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  it("shows not found at a section that does not exist", async () => {
    renderApp({ path: "/admin/secrets", api: ownerApi() });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

describe("owner console pages", () => {
  it("shows the headline numbers with the period before and the change", async () => {
    await openConsole();

    expect(within(tile("Regular and Core players")).getByText("11")).toBeVisible();
    expect(tile("Regular and Core players")).toHaveTextContent(
      "North Star: played 2 or more days in the full week from 2025-03-03",
    );
    expect(tile("Regular and Core players")).toHaveTextContent("Before: fewer than 5");
    expect(tile("Weekly returning players")).not.toHaveTextContent("North Star");
    expect(within(tile("Active players")).getByText("16")).toBeVisible();
    expect(tile("Active players")).toHaveTextContent("Before: 0 (new)");
    expect(tile("Matches finished")).toHaveTextContent("Before: 30 (−30.0%)");
    expect(tile("New players")).toHaveTextContent("Before: 16 (no change)");
    expect(tile("Weekly returning players")).toHaveTextContent(
      "real play on 3 or more days in the full week from 2025-03-03",
    );
    expect(tile("Weekly returning players")).toHaveTextContent("Before: 5 (+100.0%)");
    expect(tile("Matches per player")).toHaveTextContent("2.63");
    expect(tile("Matches per player")).toHaveTextContent("Before: fewer than 5");
    expect(tile("Guest to account")).toHaveTextContent("33.3%");
    expect(screen.getByRole("heading", { name: "Coming next" })).toBeVisible();
    expect(document.title).toBe("Overview · Owner console · ClassiCade");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });

  it("asks for the range in the address, and for the default range without one", async () => {
    const api = ownerApi();
    await openConsole(`/admin/games?${WEEK}`, api);
    expect(api.getAnalytics).toHaveBeenLastCalledWith({
      from: "2025-03-03",
      to: "2025-03-09",
      bucket: "day",
    });
  });

  it("asks for the server's default range when the address has none", async () => {
    const api = ownerApi();
    await openConsole("/admin", api);

    expect(api.getAnalytics).toHaveBeenLastCalledWith({
      from: undefined,
      to: undefined,
      bucket: undefined,
    });
  });

  it.each([
    ["players", "Active players", ["Stickiness", "New players"]],
    ["games", "Matches finished", ["Who played whom", "Did not count (anti-farming)"]],
    ["retention", "Cohort retention", ["Day 1 return"]],
    ["conversion", "Sign ups", ["Accounts created"]],
    ["engagement", "Busiest hours (India time)", ["Top achievements unlocked", "Leaderboard participants"]],
    ["statuses", "Player statuses by week", ["Moves between statuses", "Came back"]],
  ])("draws the %s page", async (section, heading, more) => {
    renderApp({ path: `/admin/${section}?${WEEK}`, api: ownerApi() });

    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    for (const text of more) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    const tabs = screen.getByRole("navigation", { name: "Console sections" });
    expect(
      within(tabs).getByRole("link", { name: section[0].toUpperCase() + section.slice(1) }),
    ).toHaveAttribute("aria-current", "page");
  });

  it.each(["", "/players", "/games", "/retention", "/conversion", "/engagement", "/statuses"])(
    "gives every control on the console%s a stable name (CC-164)",
    async (section) => {
      await openConsole(`/admin${section}?${WEEK}`);

      const unnamed = [
        ...document.querySelectorAll("main button, main a[href], main summary, main input, main select"),
      ]
        .filter((element) => !element.hasAttribute("data-cc-control"))
        .map((element) => element.outerHTML.slice(0, 120));
      expect(unnamed).toEqual([]);
    },
  );

  it("gives every chart a summary for screen readers and the same numbers as a table", async () => {
    await openConsole(`/admin/players?${WEEK}`);

    const chart = screen.getAllByRole("img")[0];
    expect(chart).toHaveAccessibleName(
      /^Active players, 7 bars from 2025-03-03 to 2025-03-09\. Highest 10\./,
    );
    const table = screen.getByRole("table", { name: "Active players" });
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getAllByRole("cell", { name: "10" }).length).toBeGreaterThan(0);
  });

  it("writes hidden groups as fewer than 5 in the engagement lists and the heatmap", async () => {
    await openConsole(`/admin/engagement?${WEEK}`);

    expect(screen.getAllByText("Rising Star")[0]).toBeVisible();
    expect(screen.getAllByText("fewer than 5").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /Busiest: Mon 20:00, 5 matches\./ })).toBeVisible();
  });

  it("draws hidden groups, empty lists, a quiet week and a game this build does not know", async () => {
    const quiet = structuredClone(REPORT);
    quiet.players.active = quiet.players.active.map((row) => ({ ...row, players: "<5", accounts: "<5" }));
    quiet.engagement.achievements = [];
    quiet.engagement.hours = quiet.engagement.hours.map((row) => ({ ...row, hours: row.hours.map(() => 0) }));
    quiet.games.gameIds = [...quiet.games.gameIds, "ludo"];
    const api = ownerApi({ getAnalytics: vi.fn().mockResolvedValue(quiet) });

    await openConsole(`/admin/players?${WEEK}`, api);
    expect(screen.getAllByRole("img")[0]).toHaveAccessibleName(/Highest 0\./);

    await userEvent.click(screen.getByRole("link", { name: "Engagement" }));
    expect(await screen.findByText("Nothing yet in this period.")).toBeVisible();
    expect(screen.getByRole("img", { name: /No matches yet\./ })).toBeVisible();

    const tabs = screen.getByRole("navigation", { name: "Console sections" });
    await userEvent.click(within(tabs).getByRole("link", { name: "Games" }));
    expect(await screen.findByText("ludo", { selector: "li" })).toBeVisible();
  });

  it("keeps the range when switching tabs", async () => {
    const view = await openConsole();

    await userEvent.click(screen.getByRole("link", { name: "Retention" }));

    expect(view.url()).toBe(`/admin/retention?${WEEK}`);
  });

  it("opens a new range as a new address, so Back returns to the one before", async () => {
    const view = await openConsole();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2025-03-01" } });
    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "week" } });
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(view.url()).toBe("/admin?from=2025-03-01&to=2025-03-09&bucket=week");

    await view.back();
    expect(view.url()).toBe(`/admin?${WEEK}`);
  });

  it("offers the last 7, 30, 90 and 365 days counted back from the report's own day", async () => {
    await openConsole();

    expect(screen.getByRole("link", { name: "7 days" })).toHaveAttribute(
      "href",
      "/admin?from=2026-10-11&to=2026-10-17&bucket=day",
    );
    expect(screen.getByRole("link", { name: "365 days" })).toHaveAttribute(
      "href",
      "/admin?from=2025-10-18&to=2026-10-17&bucket=week",
    );
  });

  it("exports a chart's numbers as CSV with hidden groups in words", async () => {
    const created = [];
    URL.createObjectURL = vi.fn((blob) => {
      created.push(blob);
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openConsole(`/admin/engagement?${WEEK}`);

    await userEvent.click(screen.getByRole("button", { name: "Export CSV: Top achievements unlocked" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(await created[0].text()).toBe(
      "Achievement,Players\r\nFirst Victory,12\r\nRising Star,fewer than 5\r\n",
    );
  });

  it("draws the statuses as a weekly chart and table, with the North Star and the flows of the week", async () => {
    await openConsole(`/admin/statuses?${WEEK}`);

    expect(
      screen.getByRole("img", { name: /^Players by status on the last day of each week, 1 bars/ }),
    ).toBeVisible();
    const table = screen.getByRole("table", { name: "Player statuses by week" });
    const row = within(table).getByRole("rowheader", { name: "2025-03-03" }).closest("tr");
    expect(row).toHaveTextContent("2025-03-0916fewer than 5650fewer than 5011yes");
    expect(screen.getByText(/Today is day 1/)).toBeVisible();
    expect(document.title).toBe("Statuses · Owner console · ClassiCade");
  });

  it("shows how players moved between statuses in the headline week, with what cannot be counted", async () => {
    await openConsole(`/admin/statuses?${WEEK}`);

    const table = screen.getByRole("table", { name: "Moves between statuses" });
    expect(within(table).getByRole("rowheader", { name: "Not playing yet" }).closest("tr")).toHaveTextContent(
      "Not playing yet16000000",
    );
    expect(within(table).getByRole("rowheader", { name: "Regular" }).closest("tr")).toHaveTextContent(
      "Regular00050fewer than 50",
    );
    expect(within(table).getByRole("rowheader", { name: "Dormant" }).closest("tr")).toHaveTextContent(
      "not counted",
    );
    expect(screen.getByText(/from Sunday 2025-03-02 to Sunday 2025-03-09/)).toBeVisible();
  });

  it("marks a week that is still going on", async () => {
    const going = structuredClone(REPORT);
    going.statuses.weeks[0].complete = false;
    await openConsole(
      `/admin/statuses?${WEEK}`,
      ownerApi({ getAnalytics: vi.fn().mockResolvedValue(going) }),
    );

    const table = screen.getByRole("table", { name: "Player statuses by week" });
    expect(within(table).getByRole("rowheader", { name: "2025-03-03" }).closest("tr")).toHaveTextContent(
      "not yet",
    );
  });

  it("says so when no week of the period has started yet", async () => {
    const future = structuredClone(REPORT);
    future.statuses.weeks = [];
    await openConsole(
      `/admin/statuses?${WEEK}`,
      ownerApi({ getAnalytics: vi.fn().mockResolvedValue(future) }),
    );

    expect(screen.getByRole("img", { name: /No week of this period has started yet\./ })).toBeVisible();
  });

  it("exports the statuses and the moves as CSV with hidden groups and uncounted cells in words", async () => {
    const created = [];
    URL.createObjectURL = vi.fn((blob) => {
      created.push(blob);
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openConsole(`/admin/statuses?${WEEK}`);

    await userEvent.click(screen.getByRole("button", { name: "Export CSV: Player statuses by week" }));
    await userEvent.click(screen.getByRole("button", { name: "Export CSV: Moves between statuses" }));

    expect(await created[0].text()).toBe(
      "Week from,Last day,New,Casual,Regular,Core,Lapsing,Came back,Went dormant,Regular and Core (North Star),Week over\r\n" +
        "2025-03-03,2025-03-09,16,fewer than 5,6,5,0,fewer than 5,0,11,yes\r\n",
    );
    const moves = (await created[1].text()).split("\r\n");
    expect(moves[0]).toBe("From,New,Casual,Regular,Core,Returning,Lapsing,Dormant");
    expect(moves[1]).toBe("Not playing yet,16,0,0,0,0,0,0");
    expect(moves[8]).toBe("Dormant,0,0,0,0,0,0,not counted");
  });

  it("counts legacy players' first logins apart from sign ups", async () => {
    await openConsole(`/admin/conversion?${WEEK}`);

    expect(within(tile("Legacy players back")).getByText("6")).toBeVisible();
    expect(tile("Legacy players back")).toHaveTextContent("not counted as sign ups");
    const table = screen.getByRole("table", { name: "Sign ups" });
    expect(within(table).getByRole("columnheader", { name: "Legacy players back" })).toBeInTheDocument();
  });

  it("says a weekly board is no longer kept instead of showing it as empty", async () => {
    await openConsole(`/admin/engagement?${WEEK}`);

    const table = screen.getByRole("table", { name: "Leaderboard participants" });
    const old = within(table).getByRole("cell", { name: "2025-W05" }).closest("tr");
    expect(old).toHaveTextContent("no longer kept");
    expect(screen.getByText(/kept for 28 days after the week ends/)).toBeVisible();
  });

  it("keeps the range form when the server refuses the range, without a Try again that would fail the same way", async () => {
    const getAnalytics = vi.fn().mockRejectedValue(
      new AppRequestError({
        code: "VALIDATION_FAILED",
        message: "The range must run forwards and cover at most 400 days",
        status: 400,
      }),
    );
    const view = renderApp({
      path: "/admin?from=2025-01-01&to=2026-10-18&bucket=week",
      api: ownerApi({ getAnalytics }),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That wasn't accepted. Check what you entered and try again.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByLabelText("From")).toHaveValue("2025-01-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-10-18");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(view.url()).toBe("/admin?from=2026-01-01&to=2026-10-18&bucket=week");
  });

  it("refuses a range longer than 400 days in the form, before asking the server", async () => {
    const api = ownerApi();
    const view = await openConsole(`/admin?${WEEK}`, api);

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2024-01-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Show" }));

    expect(screen.getByRole("alert")).toHaveTextContent("at most 400 days");
    expect(view.url()).toBe(`/admin?${WEEK}`);
    expect(api.getAnalytics).toHaveBeenCalledTimes(1);
  });

  it("says when the numbers could not be worked out and tries again on request", async () => {
    const getAnalytics = vi
      .fn()
      .mockRejectedValueOnce(
        new AppRequestError({ code: "INTERNAL", message: "Something broke", status: 500 }),
      )
      .mockResolvedValue(REPORT);
    renderApp({ path: "/admin", api: ownerApi({ getAnalytics }) });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That didn't work on our side. Try again in a moment.",
    );
    await act(() => userEvent.click(screen.getByRole("button", { name: "Try again" })));

    expect(await screen.findByText("Active players")).toBeVisible();
  });
});
