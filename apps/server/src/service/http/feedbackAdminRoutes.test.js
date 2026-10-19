import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { createFeedbackAccessor } from "../../data/feedbackAccessor.js";
import { createFeedbackComponent } from "../../domain/feedback/feedbackComponent.js";
import { createInMemoryFeedbackDao } from "../../testing/inMemoryFeedbackDao.js";
import { createAdminAccess } from "./adminAccess.js";
import { createAdminRoutes } from "./adminRoutes.js";
import { errorHandler, notFoundHandler } from "./errorMiddleware.js";
import { createFeedbackRoutes } from "./feedbackRoutes.js";

// CC-290: the owner's feedback inbox. Only an admin (ADR-036) reads or changes it, and everyone else gets the same
// 404 as any other admin address.
const ADMIN = { kind: "user", id: "user_65f0c2a1b2c3d4e5f6a7b8c9", displayName: "Owner" };
const PLAYER = { kind: "user", id: "user_000000000000000000000001", displayName: "Riya" };
const GUEST = { kind: "guest", id: "guest_00000000-0000-4000-8000-000000000001", displayName: "Guest-T001" };
const T0 = Date.UTC(2026, 9, 20, 12);

/** The feedback and admin routes behind a fake session: the test says who is asking with a header, as JSON. */
async function inbox(items = []) {
  let clock = T0;
  let counter = 0;
  const feedbackComponent = createFeedbackComponent({
    feedbackAccessor: createFeedbackAccessor({ feedbackDao: createInMemoryFeedbackDao() }),
    ages: { adultsAmong: async () => new Set() },
    // The items here are sent by visitors, and some carry a reply email.
    replyEmailOnlyForAdults: false,
    newFeedbackId: () => `00000000-0000-4000-a000-${String(++counter).padStart(12, "0")}`,
  });
  for (const item of items) {
    clock += 1000;
    await feedbackComponent.submit({ sender: { kind: "visitor" }, feedback: item, now: clock });
  }
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const who = req.get("X-Test-Identity");
    req.session = who === undefined ? {} : { identity: JSON.parse(who) };
    req.sessionID = "test-session";
    req.log = { info: () => {}, error: () => {} };
    req.id = "test";
    next();
  });
  const { requireAdmin } = createAdminAccess({ adminAccountIds: [ADMIN.id] });
  app.use(
    "/api",
    createFeedbackRoutes({ feedbackComponent, requireAdmin, now: () => clock + 60_000 }),
    createAdminRoutes({ analyticsComponent: {}, requireAdmin, now: () => clock }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, feedbackComponent };
}

const as = (req, identity) =>
  identity === undefined ? req : req.set("X-Test-Identity", JSON.stringify(identity));
const get = (app, path, identity) => as(request(app).get(path), identity);
const patch = (app, path, body, identity) => as(request(app).patch(path).send(body), identity);
const remove = (app, path, identity) => as(request(app).delete(path), identity);

const item = (fields = {}) => ({
  type: "bug",
  message: "The board froze",
  page: "/",
  build: "dev",
  device: "desktop",
  ...fields,
});

describe("GET /api/admin/feedback (CC-290)", () => {
  it("answers an admin the items newest first, never cached and never listed", async () => {
    const { app } = await inbox([item({ message: "first" }), item({ type: "idea", message: "second" })]);

    const res = await get(app, "/api/admin/feedback", ADMIN);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.body.items.map((each) => each.message)).toEqual(["second", "first"]);
    expect(res.body.items[0]).toEqual({
      ...item({ type: "idea", message: "second" }),
      feedbackId: expect.any(String),
      kind: "visitor",
      status: "new",
      hasReplyEmail: false,
      createdAt: T0 + 2000,
      updatedAt: T0 + 2000,
    });
    expect(res.body).not.toHaveProperty("next");
  });

  it("never lists a reply email, only whether an item has one", async () => {
    const { app } = await inbox([item({ replyEmail: "riya@example.com" })]);

    const res = await get(app, "/api/admin/feedback", ADMIN);

    expect(res.body.items[0].hasReplyEmail).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("riya@example.com");
  });

  it("filters by type and by status", async () => {
    const { app, feedbackComponent } = await inbox([item(), item({ type: "idea" }), item({ type: "other" })]);
    const { items } = await feedbackComponent.list({ where: { type: "bug" }, limit: 1 });
    await feedbackComponent.setStatus({ feedbackId: items[0].feedbackId, status: "done", now: T0 });

    const ideas = await get(app, "/api/admin/feedback?type=idea", ADMIN);
    const done = await get(app, "/api/admin/feedback?status=done", ADMIN);
    const newBugs = await get(app, "/api/admin/feedback?type=bug&status=new", ADMIN);

    expect(ideas.body.items.map((each) => each.type)).toEqual(["idea"]);
    expect(done.body.items.map((each) => each.type)).toEqual(["bug"]);
    expect(newBugs.body.items).toEqual([]);
  });

  it("answers 50 at a time with a cursor to the older ones, which never repeats or skips one", async () => {
    const { app } = await inbox(Array.from({ length: 51 }, (_, i) => item({ message: `m${i}` })));

    const first = await get(app, "/api/admin/feedback", ADMIN);
    const second = await get(app, `/api/admin/feedback?before=${encodeURIComponent(first.body.next)}`, ADMIN);

    expect(first.body.items).toHaveLength(50);
    expect(first.body.next).toEqual(expect.any(String));
    expect(second.body.items.map((each) => each.message)).toEqual(["m0"]);
    expect(second.body).not.toHaveProperty("next");
  });

  it.each([
    ["an unknown type", "?type=praise"],
    ["an unknown status", "?status=archived"],
    ["an unknown parameter", "?limit=500"],
    ["a cursor that is not one", "?before=yesterday"],
    ["a type given twice", "?type=bug&type=idea"],
  ])("answers 400 for %s", async (_, query) => {
    const { app } = await inbox();

    const res = await get(app, `/api/admin/feedback${query}`, ADMIN);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it.each([
    ["a visitor", undefined],
    ["a guest", GUEST],
    ["an account that is not an admin", PLAYER],
  ])("answers %s the same 404 as an unknown admin address", async (_, identity) => {
    const { app } = await inbox([item()]);

    const res = await get(app, "/api/admin/feedback", identity);
    const unknown = await get(app, "/api/admin/nothing-here", identity);

    expect(res.status).toBe(404);
    expect({ ...res.body.error, requestId: 0 }).toEqual({ ...unknown.body.error, requestId: 0 });
    expect(JSON.stringify(res.body)).not.toContain("froze");
  });
});

describe("GET /api/admin/feedback/:feedbackId (CC-290)", () => {
  it("answers an admin the whole item, the reply email included, never cached", async () => {
    const { app, feedbackComponent } = await inbox([item({ replyEmail: "riya@example.com" })]);
    const [{ feedbackId }] = (await feedbackComponent.list({ where: {}, limit: 1 })).items;

    const res = await get(app, `/api/admin/feedback/${feedbackId}`, ADMIN);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.item).toEqual(expect.objectContaining({ feedbackId, replyEmail: "riya@example.com" }));
  });

  it("answers 404 for an item that is not there and 400 for an id that is not one", async () => {
    const { app } = await inbox();

    expect((await get(app, "/api/admin/feedback/00000000-0000-4000-a000-0000000000ff", ADMIN)).status).toBe(404);
    expect((await get(app, "/api/admin/feedback/not-an-id", ADMIN)).status).toBe(400);
  });

  it.each([
    ["a visitor", undefined],
    ["a guest", GUEST],
    ["an account that is not an admin", PLAYER],
  ])("answers %s 404 without the item", async (_, identity) => {
    const { app, feedbackComponent } = await inbox([item({ replyEmail: "riya@example.com" })]);
    const [{ feedbackId }] = (await feedbackComponent.list({ where: {}, limit: 1 })).items;

    const res = await get(app, `/api/admin/feedback/${feedbackId}`, identity);

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("riya@example.com");
  });
});

describe("DELETE /api/admin/feedback/:feedbackId (CC-290)", () => {
  it("deletes an item for good and answers 204", async () => {
    const { app, feedbackComponent } = await inbox([item({ message: "gone" }), item({ message: "kept" })]);
    const [{ feedbackId }] = (await feedbackComponent.list({ where: {}, limit: 2 })).items.filter(
      (each) => each.message === "gone",
    );

    const res = await remove(app, `/api/admin/feedback/${feedbackId}`, ADMIN);

    expect(res.status).toBe(204);
    expect((await feedbackComponent.list({ where: {}, limit: 10 })).items.map((each) => each.message)).toEqual([
      "kept",
    ]);
    expect((await remove(app, `/api/admin/feedback/${feedbackId}`, ADMIN)).status).toBe(404);
  });

  it("answers 400 for an id that is not one", async () => {
    const { app } = await inbox();

    expect((await remove(app, "/api/admin/feedback/not-an-id", ADMIN)).status).toBe(400);
  });

  it.each([
    ["a visitor", undefined],
    ["a guest", GUEST],
    ["an account that is not an admin", PLAYER],
  ])("answers %s 404 and deletes nothing", async (_, identity) => {
    const { app, feedbackComponent } = await inbox([item()]);
    const [{ feedbackId }] = (await feedbackComponent.list({ where: {}, limit: 1 })).items;

    const res = await remove(app, `/api/admin/feedback/${feedbackId}`, identity);

    expect(res.status).toBe(404);
    expect((await feedbackComponent.list({ where: {}, limit: 1 })).items).toHaveLength(1);
  });
});

describe("PATCH /api/admin/feedback/:feedbackId (CC-290)", () => {
  it("moves an item to another status and answers it as it is now", async () => {
    const { app, feedbackComponent } = await inbox([item()]);
    const [{ feedbackId }] = (await feedbackComponent.list({ where: {}, limit: 1 })).items;

    const read = await patch(app, `/api/admin/feedback/${feedbackId}`, { status: "read" }, ADMIN);
    const back = await patch(app, `/api/admin/feedback/${feedbackId}`, { status: "new" }, ADMIN);

    expect(read.status).toBe(200);
    expect(read.headers["cache-control"]).toBe("no-store");
    expect(read.body.item).toEqual(
      expect.objectContaining({ feedbackId, status: "read", updatedAt: T0 + 61_000 }),
    );
    expect(back.body.item.status).toBe("new");
  });

  it("answers 404 for an item that is not there", async () => {
    const { app } = await inbox();

    const res = await patch(
      app,
      "/api/admin/feedback/00000000-0000-4000-a000-0000000000ff",
      { status: "done" },
      ADMIN,
    );

    expect(res.status).toBe(404);
  });

  it.each([
    ["an unknown status", "00000000-0000-4000-a000-000000000001", { status: "archived" }],
    ["another field", "00000000-0000-4000-a000-000000000001", { status: "done", message: "edited" }],
    ["no status", "00000000-0000-4000-a000-000000000001", {}],
    ["an id that is not one", "not-an-id", { status: "done" }],
  ])("answers 400 for %s and changes nothing", async (_, feedbackId, body) => {
    const { app, feedbackComponent } = await inbox([item()]);

    const res = await patch(app, `/api/admin/feedback/${feedbackId}`, body, ADMIN);

    expect(res.status).toBe(400);
    const [stored] = (await feedbackComponent.list({ where: {}, limit: 1 })).items;
    expect(stored).toEqual(expect.objectContaining({ status: "new", message: "The board froze" }));
  });

  it.each([
    ["a visitor", undefined],
    ["a guest", GUEST],
    ["an account that is not an admin", PLAYER],
  ])("answers %s 404 and changes nothing", async (_, identity) => {
    const { app, feedbackComponent } = await inbox([item()]);
    const [{ feedbackId }] = (await feedbackComponent.list({ where: {}, limit: 1 })).items;

    const res = await patch(app, `/api/admin/feedback/${feedbackId}`, { status: "done" }, identity);

    expect(res.status).toBe(404);
    expect((await feedbackComponent.list({ where: {}, limit: 1 })).items[0].status).toBe("new");
  });
});
