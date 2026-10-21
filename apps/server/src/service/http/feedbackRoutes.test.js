import request from "supertest";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, FEEDBACK_KEEP_DAYS, FEEDBACK_MESSAGE_MAX } from "@classicade/shared";
import { createTestApp } from "../../testing/testApp.js";
import { FEEDBACK_ITEM_MAX_BYTES, FEEDBACK_LIMITS, FEEDBACK_STORAGE_BUDGET_BYTES } from "./feedbackRoutes.js";
import { minorBirthYear } from "../../testing/birthYears.js";

// CC-290, ADR-059: anyone can send feedback. What is stored never names the player, and the limits hold per
// session, per address and for the whole site.
const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery";

const feedback = (fields = {}) => ({
  type: "bug",
  message: "The board froze after my move",
  page: "/games/chess/rooms/:code",
  build: "0.1.0+abc1234",
  device: "phone",
  ...fields,
});

/** A browser: a supertest agent that keeps its cookie, sends our Origin and may say which address it is. */
function browser(app, address) {
  const agent = request.agent(app);
  const withHeaders = (req) => {
    req.set("Origin", ORIGIN);
    return address === undefined ? req : req.set("X-Forwarded-For", address);
  };
  return {
    post: (path, body) => withHeaders(agent.post(`/api${path}`)).send(body),
    get: (path) => withHeaders(agent.get(`/api${path}`)),
  };
}

async function guest(app, address) {
  const player = browser(app, address);
  expect((await player.post("/session/guest")).status).toBe(201);
  return player;
}

let accounts = 0;
async function account(app, { birthYear } = {}) {
  const player = browser(app);
  const n = ++accounts;
  const res = await player.post("/auth/signup", {
    username: `player${n}`,
    email: `player${n}@example.com`,
    password: PASSWORD,
    ...(birthYear !== undefined && { birthYear }),
  });
  expect(res.status).toBe(201);
  return player;
}

/** Every stored item with everything it holds, newest first. */
const stored = async ({ feedbackComponent }) =>
  Promise.all(
    (await feedbackComponent.list({ where: {}, limit: 50 })).items.map(({ feedbackId }) =>
      feedbackComponent.get({ feedbackId }),
    ),
  );
const generous = Object.freeze({ windowMs: 60_000, limit: 1000 });

describe("POST /api/feedback (CC-290)", () => {
  it("stores a guest's feedback with the context, as new, and answers 201 without anything about the player", async () => {
    const testApp = createTestApp({ now: () => Date.UTC(2026, 9, 20, 12) });
    const player = await guest(testApp.app);

    const res = await player.post("/feedback", feedback());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      feedback: { feedbackId: expect.any(String), status: "new", createdAt: Date.UTC(2026, 9, 20, 12) },
    });
    expect(await stored(testApp)).toEqual([
      {
        ...feedback(),
        feedbackId: res.body.feedback.feedbackId,
        kind: "guest",
        status: "new",
        createdAt: Date.UTC(2026, 9, 20, 12),
        updatedAt: Date.UTC(2026, 9, 20, 12),
      },
    ]);
  });

  it("stores no player id, session id, address or user agent", async () => {
    const testApp = createTestApp();
    const player = await guest(testApp.app);
    const { body: session } = await player.get("/session");

    await player.post("/feedback", feedback()).set("User-Agent", "Mozilla/5.0 (Linux; Android 14) TestPhone");

    const text = JSON.stringify(await stored(testApp));
    expect(text).not.toContain(session.identity.id);
    expect(text).not.toContain("127.0.0.1");
    expect(text).not.toContain("TestPhone");
    expect(Object.keys((await stored(testApp))[0]).sort()).toEqual(
      [
        "build",
        "createdAt",
        "device",
        "feedbackId",
        "kind",
        "message",
        "page",
        "status",
        "type",
        "updatedAt",
      ].sort(),
    );
  });

  it("takes a visitor's feedback without starting a session", async () => {
    const testApp = createTestApp();

    const res = await browser(testApp.app).post("/feedback", feedback());

    expect(res.status).toBe(201);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await stored(testApp))[0].kind).toBe("visitor");
  });

  it("records an account as an account", async () => {
    const testApp = createTestApp();
    const player = await account(testApp.app);

    await player.post("/feedback", feedback());

    expect((await stored(testApp))[0].kind).toBe("account");
  });

  it("keeps an adult's reply email in its one spelling", async () => {
    const testApp = createTestApp();
    const player = await account(testApp.app, { birthYear: 1990 });

    const res = await player.post("/feedback", feedback({ replyEmail: "  Riya@Example.COM " }));

    expect(res.status).toBe(201);
    expect((await stored(testApp))[0].replyEmail).toBe("riya@example.com");
  });

  it.each([
    ["a guest", (app) => guest(app)],
    ["a visitor", async (app) => browser(app)],
    ["an account of unknown age", (app) => account(app)],
    ["a minor's account", (app) => account(app, { birthYear: minorBirthYear() })],
  ])("refuses a reply email from %s and stores nothing", async (_, who) => {
    const testApp = createTestApp();
    const player = await who(testApp.app);

    const res = await player.post("/feedback", feedback({ replyEmail: "kid@example.com" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(
      expect.objectContaining({ code: ERROR_CODES.VALIDATION_FAILED, details: { field: "replyEmail" } }),
    );
    expect(await stored(testApp)).toEqual([]);
  });

  it("removes control characters other than new lines and tabs, and keeps Windows new lines as one", async () => {
    const testApp = createTestApp();

    await browser(testApp.app).post(
      "/feedback",
      feedback({ message: " Line one\r\nline\ttwo\u0000\u0007\u001b " }),
    );

    expect((await stored(testApp))[0].message).toBe("Line one\nline\ttwo");
  });

  it("masks an email address or an Indian mobile number typed in the message before it is stored", async () => {
    const testApp = createTestApp();

    await browser(testApp.app).post(
      "/feedback",
      feedback({ message: "WhatsApp me on +91 98765 43210 or 9876543210, or mail riya.s@example.co.in" }),
    );

    expect((await stored(testApp))[0].message).toBe(
      "WhatsApp me on [phone removed] or [phone removed], or mail [email removed]",
    );
  });

  it("keeps markup as the characters typed: it is plain text, never HTML", async () => {
    const testApp = createTestApp();
    const message = '<img src=x onerror="alert(1)"> & <script>alert(2)</script>';

    await browser(testApp.app).post("/feedback", feedback({ message }));

    expect((await stored(testApp))[0].message).toBe(message);
  });

  it("takes a message of exactly the longest length", async () => {
    const testApp = createTestApp();

    const res = await browser(testApp.app).post(
      "/feedback",
      feedback({ message: "a".repeat(FEEDBACK_MESSAGE_MAX) }),
    );

    expect(res.status).toBe(201);
  });

  it.each([
    ["a body that is not an object", ["bug"], undefined],
    ["an unknown field", feedback({ userAgent: "x" }), "userAgent"],
    ["a player id sent by the page", feedback({ playerId: "guest_x" }), "playerId"],
    ["no type", { ...feedback(), type: undefined }, "type"],
    ["an unknown type", feedback({ type: "praise" }), "type"],
    ["a message that is not text", feedback({ message: 42 }), "message"],
    ["an empty message", feedback({ message: "" }), "message"],
    ["a message of only spaces and control characters", feedback({ message: " \n\u0000 " }), "message"],
    [
      "a message one character too long",
      feedback({ message: "a".repeat(FEEDBACK_MESSAGE_MAX + 1) }),
      "message",
    ],
    ["a page with a query", feedback({ page: "/games/chess?next=/x" }), "page"],
    ["a page with a hash", feedback({ page: "/profile#matches" }), "page"],
    ["a page holding a room code", feedback({ page: "/games/chess/rooms/AB2CD3" }), "page"],
    ["a page holding a lower case code", feedback({ page: "/room/ab2cd3" }), "page"],
    ["a page holding a name", feedback({ page: "/u/Riya_99/userprofile" }), "page"],
    ["a page that is not a path", feedback({ page: "https://evil.example/" }), "page"],
    ["a page that is too long", feedback({ page: `/${"a".repeat(120)}` }), "page"],
    ["a build with spaces", feedback({ build: "1.0 beta" }), "build"],
    ["an empty build", feedback({ build: "" }), "build"],
    ["an unknown device", feedback({ device: "iPhone 15" }), "device"],
    ["a reply email that is not one", feedback({ replyEmail: "riya" }), "replyEmail"],
    ["an empty reply email", feedback({ replyEmail: "" }), "replyEmail"],
  ])("answers 400 for %s", async (_, body, field) => {
    const testApp = createTestApp();

    const res = await browser(testApp.app).post("/feedback", body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    if (field !== undefined) {
      expect(JSON.stringify(res.body.error.details)).toContain(field);
    }
    expect(await stored(testApp)).toEqual([]);
  });

  it("refuses a request from another site (ADR-010)", async () => {
    const testApp = createTestApp();

    const res = await request(testApp.app)
      .post("/api/feedback")
      .set("Origin", "https://evil.example")
      .send(feedback());

    expect(res.status).toBe(403);
    expect(await stored(testApp)).toEqual([]);
  });

  it("refuses a body that is not JSON, which a cross-site form could send (ADR-010)", async () => {
    const testApp = createTestApp();

    const res = await request(testApp.app)
      .post("/api/feedback")
      .set("Content-Type", "text/plain")
      .send(JSON.stringify(feedback()));

    expect(res.status).toBe(415);
    expect(await stored(testApp)).toEqual([]);
  });
});

describe("GET /api/feedback/form (CC-290)", () => {
  it.each([
    ["an adult account", (app) => account(app, { birthYear: 1990 }), true],
    ["an account of unknown age", (app) => account(app), false],
    ["a guest", (app) => guest(app), false],
    ["a visitor", async (app) => browser(app), false],
  ])("tells %s whether the dialog offers an email reply", async (_, who, replyEmail) => {
    const testApp = createTestApp();
    const player = await who(testApp.app);

    const res = await player.get("/feedback/form");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ form: { replyEmail } });
  });
});

describe("limits on feedback (CC-290, ADR-035)", () => {
  it("sizes the site's daily cap from the storage it may use over the 180 days", () => {
    const largest = {
      feedbackId: "00000000-0000-4000-a000-000000000001",
      type: "other",
      message: "\u20ac".repeat(FEEDBACK_MESSAGE_MAX),
      replyEmail: `${"a".repeat(64)}@${"b".repeat(185)}.com`,
      page: `/${"a".repeat(99)}`,
      build: "0".repeat(40),
      device: "desktop",
      kind: "account",
      status: "done",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(Buffer.byteLength(JSON.stringify(largest))).toBeLessThanOrEqual(FEEDBACK_ITEM_MAX_BYTES);
    expect(FEEDBACK_LIMITS.site.limit).toBe(
      Math.floor(FEEDBACK_STORAGE_BUDGET_BYTES / (FEEDBACK_KEEP_DAYS * FEEDBACK_ITEM_MAX_BYTES)),
    );
    expect(FEEDBACK_LIMITS.site.windowMs).toBe(FEEDBACK_LIMITS.perAddressDaily.windowMs);
    // One address takes at most a tenth of a day's share, so it alone can never close feedback for everyone.
    expect(FEEDBACK_LIMITS.perAddressDaily.limit * 10).toBeLessThanOrEqual(FEEDBACK_LIMITS.site.limit);
  });

  it("stops one address at its daily share, long before the site's cap, and other addresses still can", async () => {
    const testApp = createTestApp({
      env: { TRUST_PROXY_HOPS: "1" },
      feedbackLimits: { perSession: generous, perAddress: generous },
    });
    const visitor = browser(testApp.app, "203.0.113.7");

    const statuses = [];
    for (let i = 0; i <= FEEDBACK_LIMITS.perAddressDaily.limit; i++) {
      statuses.push((await visitor.post("/feedback", feedback())).status);
    }
    const elsewhere = await browser(testApp.app, "198.51.100.9").post("/feedback", feedback());

    expect(statuses.filter((status) => status === 201)).toHaveLength(FEEDBACK_LIMITS.perAddressDaily.limit);
    expect(statuses.at(-1)).toBe(429);
    expect(elsewhere.status).toBe(201);
  });

  it("counts a whole IPv6 /48 as one address for the daily share", async () => {
    const testApp = createTestApp({
      env: { TRUST_PROXY_HOPS: "1" },
      feedbackLimits: {
        perSession: generous,
        perAddress: generous,
        perAddressDaily: { windowMs: 60_000, limit: 2 },
      },
    });

    const sameNetwork = [];
    for (const address of ["2001:db8:1:100::1", "2001:db8:1:200::1", "2001:db8:1:300::1"]) {
      sameNetwork.push((await browser(testApp.app, address).post("/feedback", feedback())).status);
    }
    const otherNetwork = await browser(testApp.app, "2001:db8:2::1").post("/feedback", feedback());

    expect(sameNetwork).toEqual([201, 201, 429]);
    expect(otherNetwork.status).toBe(201);
  });

  it("answers 429 once one session sends too many, and another session from the same address still can", async () => {
    const testApp = createTestApp({
      feedbackLimits: { perSession: { windowMs: 60_000, limit: 2 }, perAddress: generous, site: generous },
    });
    const [riya, arjun] = [await guest(testApp.app), await guest(testApp.app)];

    const sent = [];
    for (let i = 0; i < 3; i++) sent.push((await riya.post("/feedback", feedback())).status);
    const other = await arjun.post("/feedback", feedback());

    expect(sent).toEqual([201, 201, 429]);
    expect(other.status).toBe(201);
    expect(await stored(testApp)).toHaveLength(3);
  });

  it("answers 429 with the standard body once one address sends too many, visitors and new guests alike", async () => {
    const testApp = createTestApp({
      env: { TRUST_PROXY_HOPS: "1" },
      feedbackLimits: { perSession: generous, perAddress: { windowMs: 60_000, limit: 2 }, site: generous },
    });
    const visitor = browser(testApp.app, "203.0.113.7");
    const newGuest = await guest(testApp.app, "203.0.113.7");

    await visitor.post("/feedback", feedback());
    await newGuest.post("/feedback", feedback());
    const limited = await visitor.post("/feedback", feedback());
    const elsewhere = await browser(testApp.app, "198.51.100.9").post("/feedback", feedback());

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(elsewhere.status).toBe(201);
  });

  it("counts for the address only what the session's own limit let through", async () => {
    const testApp = createTestApp({
      feedbackLimits: {
        perSession: { windowMs: 60_000, limit: 1 },
        perAddress: { windowMs: 60_000, limit: 2 },
        site: generous,
      },
    });
    const [riya, arjun] = [await guest(testApp.app), await guest(testApp.app)];

    const flood = [];
    for (let i = 0; i < 4; i++) flood.push((await riya.post("/feedback", feedback())).status);
    const other = await arjun.post("/feedback", feedback());

    expect(flood).toEqual([201, 429, 429, 429]);
    expect(other.status).toBe(201);
  });

  it("answers 429 once the whole site has taken its share, from any address", async () => {
    const testApp = createTestApp({
      env: { TRUST_PROXY_HOPS: "1" },
      feedbackLimits: { perSession: generous, perAddress: generous, site: { windowMs: 60_000, limit: 2 } },
    });

    const statuses = [];
    for (const address of ["203.0.113.1", "203.0.113.2", "203.0.113.3"]) {
      statuses.push((await browser(testApp.app, address).post("/feedback", feedback())).status);
    }

    expect(statuses).toEqual([201, 201, 429]);
    expect(await stored(testApp)).toHaveLength(2);
  });

  it("does not count a refused message against the site", async () => {
    const testApp = createTestApp({
      feedbackLimits: { perSession: generous, perAddress: generous, site: { windowMs: 60_000, limit: 1 } },
    });
    const visitor = browser(testApp.app);

    await visitor.post("/feedback", feedback({ type: "praise" }));
    const res = await visitor.post("/feedback", feedback());

    expect(res.status).toBe(201);
  });
});
