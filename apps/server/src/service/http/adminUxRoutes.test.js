import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { flagPaths } from "../../testing/flagPaths.js";
import { uxReportOver } from "../../testing/uxFixture.js";
import { startOfDay } from "../../utils/indiaTime.js";
import { createAdminAccess } from "./adminAccess.js";
import { createAdminUxRoutes } from "./adminUxRoutes.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";

const ADMIN = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Owner" };
const PLAYER = { kind: "user", id: "user_000000000000000000000001", displayName: "Riya" };
const GUEST = { kind: "guest", id: "guest_00000000-0000-4000-8000-000000000001", displayName: "Guest-T001" };
// 09:00 in India on Wednesday 2026-10-21.
const NOW = startOfDay("2026-10-21") + 9 * 60 * 60 * 1000;

let uxReport;
beforeAll(async () => {
  ({ uxReport } = await uxReportOver({ now: NOW }));
});

/** The routes behind a fake session: the test says who is asking with a header. `on` lists the flags that are on. */
function uxApp({ on = ["console_ux", "console_ux_week"] } = {}) {
  const asked = [];
  const app = express();
  app.use((req, res, next) => {
    const who = req.get("X-Test-Identity");
    req.session = who === undefined ? {} : { identity: JSON.parse(who) };
    req.log = { error: () => {} };
    req.id = "test";
    next();
  });
  const adminAccess = createAdminAccess({ adminAccountIds: [ADMIN.id] });
  const flagComponent = {
    isOn: async (name, player) => {
      asked.push({ name, player });
      return on.includes(name);
    },
  };
  app.use("/api", createAdminUxRoutes({ uxReport, adminAccess, flagComponent, now: () => NOW }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, asked };
}

const get = (app, path, identity) => {
  const req = request(app).get(path);
  return identity === undefined ? req : req.set("X-Test-Identity", JSON.stringify(identity));
};

describe("GET /api/admin/ux (CC-177)", () => {
  // AC-1
  it.each([
    ["a visitor without a session", undefined],
    ["a guest", GUEST],
    ["an account that is not an admin", PLAYER],
    ["a session whose identity is broken", { kind: "user", id: ADMIN.id, displayName: "x" }],
  ])("anyone but an admin gets 404: %s", async (_, identity) => {
    const { app, asked } = uxApp();

    const res = await get(app, "/api/admin/ux?section=funnels", identity);
    const unknown = await get(app, "/api/admin/no-such-page", identity);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(unknown.body);
    // Not even the flags are asked about for them.
    expect(asked).toEqual([]);
  });

  it("answers an admin with the last 7 full India days against the 7 before, never cached and never listed", async () => {
    const { app } = uxApp();

    const res = await get(app, "/api/admin/ux?section=funnels", ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.report.range).toEqual({ from: "2026-10-14", to: "2026-10-20" });
    expect(res.body.report.before).toEqual({ from: "2026-10-07", to: "2026-10-13" });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  // AC-2
  it("small totals are hidden", async () => {
    const { app } = uxApp();

    const res = await get(app, "/api/admin/ux?section=clicks&from=2026-10-20&to=2026-10-20", ADMIN);

    expect(res.status).toBe(200);
    const leaderboard = res.body.report.deadHotspots.find(({ route }) => route === "/leaderboards");
    expect(leaderboard).toEqual(expect.objectContaining({ count: "<5", share: "<5" }));
    // No count of 1 to 4 anywhere in the answer, as text either.
    expect(res.text).not.toMatch(
      /"(count|now|before|shown|pages|games|presses|landings|firstMoves|n)":[1-4][,}]/,
    );
  });

  it.each([
    ["an unknown section", "section=everything"],
    ["no section", ""],
    ["only one end of the range", "section=clicks&from=2026-10-01"],
    ["only the other end of the range", "section=clicks&to=2026-10-01"],
    ["an end that is not a day", "section=clicks&from=2026-10-01&to=2026-13-01"],
    ["a day that is not a day", "section=clicks&from=2026-02-30&to=2026-03-01"],
    ["a range that ends before it starts", "section=clicks&from=2026-10-10&to=2026-10-01"],
    ["a range that reaches today", "section=clicks&from=2026-10-14&to=2026-10-21"],
    ["a range over 400 days", "section=clicks&from=2025-01-01&to=2026-10-20"],
    ["anything else in the query", "section=clicks&viewer=me"],
  ])("refuses %s with a 400", async (_, query) => {
    const { app } = uxApp();

    const res = await get(app, `/api/admin/ux?${query}`, ADMIN);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  // AC-12 (CC-313)
  it("the week report is admins only", async () => {
    const { app } = uxApp();

    const week = await get(app, "/api/admin/ux?section=week", ADMIN);
    const badge = await get(app, "/api/admin/ux?section=badge", ADMIN);
    const player = await get(app, "/api/admin/ux?section=week", PLAYER);
    const guest = await get(app, "/api/admin/ux?section=badge", GUEST);

    expect(week.status).toBe(200);
    expect(week.body.report.range).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(week.body.report.badge).toBe("red");
    expect(badge.body.report).toEqual(expect.objectContaining({ badge: "red" }));
    expect(player.status).toBe(404);
    expect(guest.status).toBe(404);
  });

  flagPaths("console_ux", (on) => {
    it(
      on ? "answers the page's sections" : "answers the page's sections with the 404 while the flag is off",
      async () => {
        const { app } = uxApp({ on: on ? ["console_ux"] : [] });

        const res = await get(app, "/api/admin/ux?section=speed", ADMIN);

        expect(res.status).toBe(on ? 200 : 404);
      },
    );
  });

  flagPaths("console_ux_week", (on) => {
    it(
      on ? "answers the week and its badge" : "answers the week with the 404 while the flag is off",
      async () => {
        const { app } = uxApp({ on: on ? ["console_ux", "console_ux_week"] : ["console_ux"] });

        const week = await get(app, "/api/admin/ux?section=week", ADMIN);
        const badge = await get(app, "/api/admin/ux?section=badge", ADMIN);
        const funnels = await get(app, "/api/admin/ux?section=funnels", ADMIN);

        expect([week.status, badge.status]).toEqual(on ? [200, 200] : [404, 404]);
        expect(funnels.status).toBe(200);
      },
    );
  });
});
