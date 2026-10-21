import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRequestError } from "../../lib/errors.js";
import { fakeApi, GUEST } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { renderApp } from "../../testing/render.jsx";
import { UX_REPORTS } from "../../testing/uxReports.js";

// CC-177: the owner's UX page in the console.
const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
const PLAYER = { kind: "user", id: "user_652f1c2e9b1e8a3d4c5b6a79", displayName: "Riya" };
// 09:00 in India on Wednesday 2026-10-21.
const WEDNESDAY = Date.UTC(2026, 9, 21, 3, 30);

const ownerApi = ({ on = ["console_ux"], ...overrides } = {}) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    getFlags: vi.fn(async (names) => Object.fromEntries(names.map((name) => [name, on.includes(name)]))),
    getUxReport: vi.fn(async ({ section }) => UX_REPORTS[section]),
    ...overrides,
  });

async function openUx(section, api = ownerApi()) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WEDNESDAY);
  const rendered = renderApp({ path: `/admin/ux${section ? `/${section}` : ""}`, api });
  await screen.findByRole("heading", { name: "UX", level: 1 });
  return { user: userEvent.setup(), ...rendered };
}

const figure = (name) => screen.findByRole("figure", { name });
const rowsOf = (table) =>
  within(table)
    .getAllByRole("row")
    .map((row) => row.textContent);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the console's UX page (CC-177)", () => {
  it.each([
    ["a visitor", fakeApi()],
    ["a guest", fakeApi({ getSession: async () => GUEST })],
    ["an account that is not an admin", fakeApi({ getSession: async () => PLAYER })],
  ])("shows %s the ordinary not found page, without asking for any totals", async (_, api) => {
    renderApp({ path: "/admin/ux", api });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(api.getUxReport).not.toHaveBeenCalled();
  });

  it("opens on the funnels of the last 7 full India days on a weekday that is not Monday", async () => {
    const { api } = await openUx();

    await figure("Visit to play");
    expect(api.getUxReport).toHaveBeenCalledWith({ section: "funnels", from: undefined, to: undefined });
    expect(screen.getByText(/^2026-10-14 to 2026-10-20, India time, against 2026-10-07/)).toBeVisible();
  });

  // AC-3
  it("funnels show totals and capped ratios", async () => {
    await openUx("funnels");

    const visit = await figure("Visit to play");
    expect(rowsOf(within(visit).getByRole("table"))).toEqual([
      "StepTotalBeforeChangeRatio to the step before",
      "Landed1,3511,080+25.1%",
      "First move959770+24.6%71.0%",
    ]);
    const link = await figure("Link to seat");
    // More presses than landings: the ratio of totals is capped at 100 % and says so.
    expect(within(link).getByRole("row", { name: /Pressed Join as guest/ })).toHaveTextContent(
      "100.0% (capped)",
    );
    expect(visit).toHaveTextContent("ratio of daily totals");
    const entries = await figure("Visit to play by entry");
    expect(within(entries).getByRole("row", { name: /Search/ })).toHaveTextContent(
      "Searchfewer than 5fewer than 5fewer than 5",
    );
    expect(await figure("Challenge, step by step")).toHaveTextContent("New");
  });

  // AC-4
  it("lists the top hotspots", async () => {
    await openUx("clicks");

    const dead = await figure("Dead click hotspots");
    const rows = rowsOf(within(dead).getByRole("table"));
    expect(rows[0]).toBe("ScreenControl or elementClicksShare of the screen's presses");
    expect(rows).toHaveLength(11);
    expect(rows[1]).toBe("/img (element)987.0%");
    expect(rows[2]).toBe("/games/rock-paper-scissorslobby.rules (control)4911.7%");
    expect(await figure("Rage click hotspots")).toHaveTextContent("room.rematch.ask");
  });

  // AC-5
  it("speed against the good lines", async () => {
    await openUx("speed");

    const table = within(await figure("Page speed by screen and device")).getByRole("table");
    expect(rowsOf(table)[1]).toBe("/Phone4203.0 s, over250 ms, over0.05, good800 ms, good");
    expect(rowsOf(table)[2]).toBe("/Desktop2101.5 s, good100 ms, good0.01, good500 ms, good");
    expect(rowsOf(table)[3]).toBe("/leaderboardsPhonefewer than 5fewer than 5no datano datano data");
    const lines = await figure("The lines");
    expect(lines).toHaveTextContent("Largest paint (LCP)2.5 s");
    expect(within(await figure("Time to first move by entry")).getByRole("table")).toHaveTextContent(
      "12.5 s",
    );
  });

  it("errors by day and by build, the last builds side by side", async () => {
    await openUx("errors");

    const builds = within(await figure("Errors by build")).getByRole("table");
    expect(rowsOf(builds)[0]).toBe("What2026.10.20+def56782026.10.18+abc1234");
    expect(rowsOf(builds)[1]).toBe("Errors in the browser21 (1.2 per 100 pages)fewer than 5");
  });

  it("the interruption budget with green, amber and red, each with its word", async () => {
    await openUx("interruptions");

    const budget = within(await figure("The interruption budget")).getByRole("table");
    expect(within(budget).getByRole("row", { name: /Optional interruptions per visit/ })).toHaveTextContent(
      "0.930.5 or less0.9Amber",
    );
    expect(within(budget).getByRole("row", { name: /Rage and dead/ })).toHaveTextContent("Red");
    expect(within(budget).getByRole("row", { name: /first move/ })).toHaveTextContent("No colour");
  });

  it("latency per control at p50 and p95, and how the waits ended", async () => {
    await openUx("latency");

    const waits = within(await figure("Wait per control")).getByRole("table");
    expect(rowsOf(waits)[1]).toBe("lobby.create280500 ms900 ms");
    expect(rowsOf(waits)[2]).toBe("room.leavefewer than 5fewer than 5fewer than 5");
    expect(await figure("How the waits ended")).toHaveTextContent("ok280");
  });

  it("marks a fall and no change in words, with the arrow hidden from readers", async () => {
    const api = ownerApi({
      getUxReport: vi.fn(async () => ({
        ...UX_REPORTS.clicks,
        presses: { now: 900, before: 1000, change: -0.1 },
        dead: { now: 20, before: 20, change: 0 },
      })),
    });
    await openUx("clicks", api);

    const presses = (await screen.findByText("Presses", { selector: "dt" })).parentElement;
    expect(presses).toHaveTextContent("Before: 1,000 (▼ −10.0%)");
    const dead = screen.getByText("Dead clicks", { selector: "dt" }).parentElement;
    expect(dead).toHaveTextContent("Before: 20 (no change)");
  });

  it("exports the budget with each colour in words", async () => {
    const created = [];
    URL.createObjectURL = vi.fn((blob) => {
      created.push(blob);
      return "blob:test";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { user } = await openUx("interruptions");
    await figure("The interruption budget");

    await user.click(screen.getByRole("button", { name: "Export CSV: The interruption budget" }));
    await user.click(screen.getByRole("button", { name: "Export CSV: Dismissed and covered, by surface" }));

    expect(await created[0].text()).toContain("Optional interruptions per visit,0.93,0.5 or less,0.9,amber");
    expect(await created[1].text()).toContain("toast.xp,630,0.3333,green,0,green");
  });

  it("shows the failure, with a retry, when a section cannot be read", async () => {
    const getUxReport = vi
      .fn()
      .mockRejectedValueOnce(
        new AppRequestError({ code: "SERVER_BUSY", message: "The server is busy", status: 503 }),
      )
      .mockImplementation(async ({ section }) => UX_REPORTS[section]);
    const { user } = await openUx("funnels", ownerApi({ getUxReport }));

    await user.click(await screen.findByRole("button", { name: "Retry" }));

    await figure("Visit to play");
  });

  it("shows the not found page for an unknown section, or when the server will not say it has the page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WEDNESDAY);
    const { unmount } = renderApp({ path: "/admin/ux/everything", api: ownerApi() });
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    unmount();

    const notFound = new AppRequestError({ code: "NOT_FOUND", message: "Not found", status: 404 });
    renderApp({
      path: "/admin/ux/clicks",
      api: ownerApi({
        getUxReport: vi.fn().mockRejectedValue(notFound),
        sendFlagSuccess: vi.fn().mockRejectedValue(notFound),
      }),
    });
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  it("keeps the page when telling the flag's success fails", async () => {
    const api = ownerApi({ sendFlagSuccess: vi.fn().mockRejectedValue(new Error("offline")) });
    await openUx("clicks", api);

    await figure("Dead click hotspots");
    expect(api.sendFlagSuccess).toHaveBeenCalledWith("console_ux");
  });

  it("refuses a range that starts after it ends, or is too long, before asking the server", async () => {
    const { user, api } = await openUx("clicks");
    await figure("Dead click hotspots");
    const asked = api.getUxReport.mock.calls.length;

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The range must start before it ends.");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2024-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-20" } });
    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at most 400 days");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    await user.click(screen.getByRole("button", { name: "Show" }));
    await vi.waitFor(() =>
      expect(api.getUxReport).toHaveBeenLastCalledWith({
        section: "clicks",
        from: "2026-10-01",
        to: "2026-10-20",
      }),
    );
    expect(api.getUxReport.mock.calls.length).toBeGreaterThan(asked);
  });

  it("loads every section again for a new range", async () => {
    const { user, api } = await openUx("clicks");
    await figure("Dead click hotspots");

    await user.click(screen.getByRole("link", { name: "Last 28 days" }));

    await figure("Dead click hotspots");
    expect(api.getUxReport).toHaveBeenLastCalledWith({
      section: "clicks",
      from: "2026-09-23",
      to: "2026-10-20",
    });
    await user.click(screen.getByRole("link", { name: "Speed" }));
    await figure("Page speed by screen and device");
    expect(api.getUxReport).toHaveBeenLastCalledWith({
      section: "speed",
      from: "2026-09-23",
      to: "2026-10-20",
    });
  });

  it("tells the owner when a range would reach today", async () => {
    const { user } = await openUx("clicks");
    await figure("Dead click hotspots");

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-21" } });
    await user.click(screen.getByRole("button", { name: "Show" }));

    expect(screen.getByRole("alert")).toHaveTextContent("A range ends yesterday at the latest");
  });

  // AC-7
  flagPaths("console_ux", (on) => {
    it(on ? "shows the UX tab and its page" : "hides the UX tab and shows no totals", async () => {
      const api = ownerApi({ on: on ? ["console_ux"] : [] });

      await openUx(undefined, api);
      const tabs = screen.getByRole("navigation", { name: "Console sections" });

      if (on) {
        await figure("Visit to play");
        expect(within(tabs).getByRole("link", { name: "UX" })).toHaveAttribute("aria-current", "page");
        expect(api.sendFlagSuccess).toHaveBeenCalledWith("console_ux");
      } else {
        expect(await screen.findByText(/behind the console_ux flag/)).toBeVisible();
        expect(within(tabs).queryByRole("link", { name: "UX" })).not.toBeInTheDocument();
        expect(api.getUxReport).not.toHaveBeenCalled();
      }
    });
  });
});
