import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { captureLogger } from "../../testing/captureLogger.js";
import { createRequestLogger, keepRoutePrefix } from "./requestLogger.js";

/** Minimal app around the middleware, with a deterministic id generator and clock. */
function setup() {
  const capture = captureLogger();
  const recorded = [];
  let time = 1_000;
  const app = express();
  app.use(
    createRequestLogger({
      logger: capture.logger,
      recordRequest: (request) => recorded.push(request),
      generateId: () => "generated-id-0001",
      now: () => {
        time += 12.345;
        return time;
      },
    }),
  );
  app.get("/ok", (req, res) => res.json({ requestId: req.id }));
  app.get("/missing", (req, res) => {
    res.locals.errorCode = "NOT_FOUND";
    res.status(404).end();
  });
  app.get("/boom", (req, res) => res.status(500).end());
  app.get("/child", (req, res) => {
    req.log.info("inside handler");
    res.end();
  });
  return { app, recorded, ...capture };
}

describe("createRequestLogger", () => {
  it("generates a request id, exposes it on req and echoes it in the response", async () => {
    const { app } = setup();

    const res = await request(app).get("/ok");

    expect(res.headers["x-request-id"]).toBe("generated-id-0001");
    expect(res.body.requestId).toBe("generated-id-0001");
  });

  it("propagates a well-formed incoming request id", async () => {
    const { app } = setup();

    const res = await request(app).get("/ok").set("X-Request-Id", "upstream-abc-123");

    expect(res.headers["x-request-id"]).toBe("upstream-abc-123");
  });

  it.each(["short", "has spaces in it", "x".repeat(65), "bad/chars!!"])(
    "replaces a malformed incoming request id (%j)",
    async (incoming) => {
      const { app } = setup();

      const res = await request(app).get("/ok").set("X-Request-Id", incoming);

      expect(res.headers["x-request-id"]).toBe("generated-id-0001");
    },
  );

  it("writes one access-log line with method, path, status and duration", async () => {
    const { app, find } = setup();

    await request(app).get("/ok?secret=1");

    expect(find("request completed")).toEqual([
      expect.objectContaining({
        level: 30,
        requestId: "generated-id-0001",
        method: "GET",
        path: "/ok",
        status: 200,
        durationMs: 12.35,
      }),
    ]);
    expect(find("request completed")[0]).not.toHaveProperty("forwardedEntries");
  });

  it("logs how many addresses X-Forwarded-For holds, but never the addresses", async () => {
    const { app, find, entries } = setup();

    await request(app).get("/ok").set("X-Forwarded-For", "203.0.113.7, 198.51.100.2");

    expect(find("request completed")[0].forwardedEntries).toBe(2);
    expect(JSON.stringify(entries)).not.toMatch(/203\.0\.113\.7|198\.51\.100\.2/);
  });

  it("logs client errors as warn with the error code, server errors as error", async () => {
    const { app, find } = setup();

    await request(app).get("/missing");
    await request(app).get("/boom");

    const [clientError, serverError] = find("request completed");
    expect(clientError).toEqual(expect.objectContaining({ level: 40, status: 404, errorCode: "NOT_FOUND" }));
    expect(serverError).toEqual(expect.objectContaining({ level: 50, status: 500 }));
    expect(serverError).not.toHaveProperty("errorCode");
  });

  it("logs the full path even when the route is mounted on a sub-router", async () => {
    const { app, find } = setup();
    const router = express.Router();
    router.get("/nested", (req, res) => res.end());
    app.use("/api", router);

    await request(app).get("/api/nested");

    expect(find("request completed")[0].path).toBe("/api/nested");
  });

  it("gives handlers a child logger bound to the request id", async () => {
    const { app, find } = setup();

    await request(app).get("/child");

    expect(find("inside handler")[0].requestId).toBe("generated-id-0001");
  });

  describe("timing for operations telemetry (ADR-055)", () => {
    it("records each request by its route template, never its path", async () => {
      const { app, recorded, find } = setup();
      app.get("/rooms/:code", (req, res) => res.end());

      await request(app).get("/rooms/AB2CDE?from=sam@example.com");

      expect(recorded).toEqual([
        { route: "/rooms/:code", method: "GET", status: 200, durationMs: expect.closeTo(12.345, 6) },
      ]);
      expect(find("request completed")[0].route).toBe("/rooms/:code");
    });

    it("records a request no route answered as unmatched", async () => {
      const { app, recorded } = setup();

      await request(app).get("/room/AB2CDE");

      expect(recorded).toEqual([expect.objectContaining({ route: "unmatched", status: 404 })]);
    });

    it("records a route written as a pattern as pattern", async () => {
      const { app, recorded } = setup();
      app.get(/^\/page\/.*/, (req, res) => res.end());
      app.get(["/a", "/b"], (req, res) => res.end());

      await request(app).get("/page/AB2CDE");
      await request(app).get("/b");

      expect(recorded.map(({ route }) => route)).toEqual(["pattern", "pattern"]);
    });

    it("keeps the prefix of the router the route is mounted on, also when the handler fails", async () => {
      const { app, recorded } = setup();
      const router = express.Router();
      router.get("/fine/:id", (req, res) => res.end());
      router.get("/broken/:id", async () => {
        throw new Error("boom");
      });
      app.use("/api", keepRoutePrefix, router);
      app.use((err, req, res, _next) => res.status(500).end());

      await request(app).get("/api/fine/user_1");
      await request(app).get("/api/broken/user_1");

      expect(recorded.map(({ route, status }) => [route, status])).toEqual([
        ["/api/fine/:id", 200],
        ["/api/broken/:id", 500],
      ]);
    });

    it("records nothing when no recorder is given", async () => {
      const app = express();
      app.use(createRequestLogger({ logger: captureLogger().logger }));
      app.get("/ok", (req, res) => res.end());

      await request(app).get("/ok").expect(200);
    });
  });
});
