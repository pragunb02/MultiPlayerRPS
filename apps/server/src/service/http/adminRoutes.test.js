import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { createAnalyticsAccessor } from "../../data/analyticsAccessor.js";
import { createAnalyticsComponent } from "../../domain/analytics/analyticsComponent.js";
import { createEmptyAnalyticsDao } from "../../testing/emptyAnalyticsDao.js";
import { createTtlCache } from "../../utils/ttlCache.js";
import { createAdminAccess } from "./adminAccess.js";
import { createAdminRoutes } from "./adminRoutes.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";

const ADMIN = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Owner" };
const PLAYER = { kind: "user", id: "user_000000000000000000000001", displayName: "Riya" };
const GUEST = { kind: "guest", id: "guest_00000000-0000-4000-8000-000000000001", displayName: "Guest-T001" };
const NOW = Date.parse("2026-10-17T06:00:00.000Z");

/** The routes behind a fake session: the test says who is asking with a header, as JSON. */
function adminApp({ adminAccountIds = [ADMIN.id] } = {}) {
  const asked = [];
  const analyticsComponent = createAnalyticsComponent({
    analyticsAccessor: createAnalyticsAccessor({ analyticsDao: createEmptyAnalyticsDao() }),
    cache: createTtlCache({ ttlMs: 1, maxEntries: 1 }),
  });
  const recording = {
    ...analyticsComponent,
    getReport: (query) => {
      asked.push(query.range);
      return analyticsComponent.getReport(query);
    },
  };
  const app = express();
  app.use((req, res, next) => {
    const who = req.get("X-Test-Identity");
    req.session = who === undefined ? {} : { identity: JSON.parse(who) };
    req.log = { error: () => {} };
    req.id = "test";
    next();
  });
  const { requireAdmin } = createAdminAccess({ adminAccountIds });
  app.use("/api", createAdminRoutes({ analyticsComponent: recording, requireAdmin, now: () => NOW }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, asked };
}

const get = (app, path, identity) => {
  const req = request(app).get(path);
  return identity === undefined ? req : req.set("X-Test-Identity", JSON.stringify(identity));
};

describe("GET /api/admin/analytics", () => {
  it("answers an admin with the last 30 India days by default, never cached and never listed", async () => {
    const { app, asked } = adminApp();

    const res = await get(app, "/api/admin/analytics", ADMIN);

    expect(res.status).toBe(200);
    expect(res.body.report.range).toEqual(expect.objectContaining({ from: "2026-09-18", to: "2026-10-17" }));
    expect(asked).toEqual([{ from: "2026-09-18", to: "2026-10-17", bucket: "day" }]);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("reports the range and bucket asked for", async () => {
    const { app, asked } = adminApp();

    const res = await get(app, "/api/admin/analytics?from=2026-01-01&to=2026-03-31&bucket=month", ADMIN);

    expect(res.status).toBe(200);
    expect(asked).toEqual([{ from: "2026-01-01", to: "2026-03-31", bucket: "month" }]);
  });

  it.each([
    ["a visitor without a session", undefined],
    ["a guest", GUEST],
    ["an account that is not an admin", PLAYER],
    ["a session whose identity is broken", { kind: "user", id: ADMIN.id, displayName: "x" }],
  ])("answers %s with the same 404 as an unknown address", async (_, identity) => {
    const { app, asked } = adminApp();

    const res = await get(app, "/api/admin/analytics?from=bad", identity);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(res.body).toEqual((await get(app, "/api/no-such-thing")).body);
    expect(asked).toEqual([]);
  });

  it("has no admins when ADMIN_ACCOUNT_IDS is empty", async () => {
    const { app } = adminApp({ adminAccountIds: [] });

    expect((await get(app, "/api/admin/analytics", ADMIN)).status).toBe(404);
  });

  it.each([
    ["?from=2026-10-01", "to"],
    ["?to=2026-10-01", "from"],
    ["?from=2026-10-01&to=2026-10-01&bucket=year", "bucket"],
    ["?from=2026-10-09&to=2026-10-01", "to"],
  ])("refuses a bad range %s", async (query, field) => {
    const { app } = adminApp();

    const res = await get(app, `/api/admin/analytics${query}`, ADMIN);

    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe(field);
  });

  it("refuses unknown query parameters", async () => {
    const { app } = adminApp();

    const res = await get(app, "/api/admin/analytics?limit=5", ADMIN);

    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toEqual(["limit"]);
  });

  it("answers 404 to an admin at an admin address that does not exist", async () => {
    const { app } = adminApp();

    expect((await get(app, "/api/admin/users", ADMIN)).status).toBe(404);
  });

  it("needs its component, guard and clock", () => {
    const { requireAdmin } = createAdminAccess({ adminAccountIds: [] });
    expect(() => createAdminRoutes({ requireAdmin, now: Date.now })).toThrow(TypeError);
    expect(() => createAdminRoutes({ analyticsComponent: {}, now: Date.now })).toThrow(TypeError);
    expect(() => createAdminRoutes({ analyticsComponent: {}, requireAdmin })).toThrow(TypeError);
  });
});
