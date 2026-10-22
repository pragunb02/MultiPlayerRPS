import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi } from "../../testing/fakes.js";
import { flagPaths } from "../../testing/flagPaths.js";
import { renderApp } from "../../testing/render.jsx";
import { UX_REPORTS } from "../../testing/uxReports.js";

// CC-313 section 8: the weekly UX report, the Week view of the console's UX page (CC-177).
const OWNER = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Site_Owner" };
// 09:00 in India on Monday 2026-10-19 and on Wednesday 2026-10-21.
const MONDAY = Date.UTC(2026, 9, 19, 3, 30);
const WEDNESDAY = Date.UTC(2026, 9, 21, 3, 30);

const ownerApi = (on = ["console_ux", "console_ux_week"]) =>
  fakeApi({
    getSession: async () => OWNER,
    getAdminStatus: vi.fn().mockResolvedValue(true),
    getFlags: vi.fn(async (names) => Object.fromEntries(names.map((name) => [name, on.includes(name)]))),
    getUxReport: vi.fn(async ({ section }) => UX_REPORTS[section]),
  });

function openOn(day, api, path = "/admin/ux") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(day);
  return renderApp({ path, api });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the Week view (CC-313)", () => {
  // AC-12
  it("the weekly report shows each section", async () => {
    const api = ownerApi();
    openOn(MONDAY, api);

    await screen.findByRole("heading", { name: "1. The interruption budget" });
    // On a Monday the page opens on the week, the last full India week against the one before.
    expect(api.getUxReport).toHaveBeenCalledWith({ section: "week", from: undefined, to: undefined });
    expect(screen.getByText(/^2026-10-12 to 2026-10-18, India time, against 2026-10-05/)).toBeVisible();
    [
      "1. The interruption budget",
      "2. The surfaces shown most",
      "3. Interruptions per visit and per game",
      "4. Text on the key screens",
      "5. Time to first move",
      "6. Rage and dead click hotspots",
      "7. The registered funnels",
      "8. Flags ramping with a friction guardrail",
    ].forEach((name) => expect(screen.getByRole("heading", { level: 2, name })).toBeVisible());
    // Small totals arrive as "<5" and read as "fewer than 5".
    const perVisit = screen.getByRole("figure", { name: "Per visit and per game" });
    expect(within(perVisit).getByRole("row", { name: /Game/ })).toHaveTextContent("fewer than 5");
    const top = screen.getByRole("figure", { name: "Top surfaces" });
    expect(within(top).getByRole("row", { name: /toast.xp/ })).toHaveTextContent("CC-017");
    // The budget's colours, each with its word.
    const budget = screen.getByRole("figure", { name: "The interruption budget" });
    expect(within(budget).getByRole("row", { name: /Rage and dead/ })).toHaveTextContent("Red");
    // A red line puts a badge on the console's UX tab.
    const tabs = screen.getByRole("navigation", { name: "Console sections" });
    expect(await within(tabs).findByRole("link", { name: /UX Red/ })).toBeVisible();
    expect(api.sendFlagSuccess).toHaveBeenCalledWith("console_ux_week");
  });

  it("opens on the funnels on any other day, with the week one tab away", async () => {
    const api = ownerApi();
    openOn(WEDNESDAY, api);

    await screen.findByRole("figure", { name: "Visit to play" });
    const sections = screen.getByRole("navigation", { name: "UX sections" });
    expect(within(sections).getByRole("link", { name: "Week" })).toHaveAttribute("href", "/admin/ux/week");
  });

  // AC-13 (the Week view's half)
  flagPaths("console_ux_week", (on) => {
    it(on ? "shows the Week view and the badge" : "shows no Week view and no badge", async () => {
      const api = ownerApi(on ? ["console_ux", "console_ux_week"] : ["console_ux"]);
      openOn(MONDAY, api);

      await screen.findByRole("heading", { name: "UX", level: 1 });
      const sections = await screen.findByRole("navigation", { name: "UX sections" });

      if (on) {
        expect(within(sections).getByRole("link", { name: "Week" })).toBeVisible();
        await screen.findByRole("heading", { name: "1. The interruption budget" });
      } else {
        // Even on a Monday the page opens on the funnels, and nothing about the week is asked for.
        await screen.findByRole("figure", { name: "Visit to play" });
        expect(within(sections).queryByRole("link", { name: "Week" })).not.toBeInTheDocument();
        expect(api.getUxReport.mock.calls.map(([query]) => query.section)).not.toContain("week");
        expect(api.getUxReport.mock.calls.map(([query]) => query.section)).not.toContain("badge");
      }
    });
  });

  it("says the week is behind its flag when its address is opened with the flag off", async () => {
    openOn(WEDNESDAY, ownerApi(["console_ux"]), "/admin/ux/week");

    expect(await screen.findByText(/behind the console_ux_week flag/)).toBeVisible();
  });
});
