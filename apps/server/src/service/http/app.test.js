import request from "supertest";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, GAMES } from "@classicade/shared";
import { loadConfig } from "../../config/index.js";
import { captureLogger } from "../../testing/captureLogger.js";
import { createHttpApp } from "./app.js";

function setup(env = { NODE_ENV: "test" }) {
  const capture = captureLogger();
  const app = createHttpApp({ config: loadConfig(env), logger: capture.logger });
  return { app, ...capture };
}

describe("HTTP app", () => {
  it("GET /api/health returns ok", async () => {
    const { app } = setup();

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/games returns the shared catalog", async () => {
    const { app } = setup();

    const res = await request(app).get("/api/games");

    expect(res.status).toBe(200);
    expect(res.body.games).toEqual(GAMES);
  });

  it("sets security headers and hides the framework", async () => {
    const { app } = setup();

    const res = await request(app).get("/api/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("trusts the first proxy only in production (for secure cookies behind TLS termination)", () => {
    expect(setup({ NODE_ENV: "production" }).app.get("trust proxy")).toBe(1);
    expect(setup().app.get("trust proxy")).toBe(false);
  });

  it("tags every response with a request id and logs it", async () => {
    const { app, find } = setup();

    const res = await request(app).get("/api/health");

    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(find("request completed")[0]).toEqual(
      expect.objectContaining({ requestId: res.headers["x-request-id"], status: 200, path: "/api/health" }),
    );
  });

  describe("error responses", () => {
    it("returns the standard error shape for unknown routes", async () => {
      const { app } = setup();

      const res = await request(app).get("/nope");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: ERROR_CODES.NOT_FOUND, message: "Not found", requestId: res.headers["x-request-id"] },
      });
    });

    it("rejects malformed JSON with 400 and a fixed message", async () => {
      const { app } = setup();

      const res = await request(app).post("/api/health").set("Content-Type", "application/json").send("{bad");

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual(
        expect.objectContaining({ code: ERROR_CODES.BAD_REQUEST, message: "Malformed request body" }),
      );
    });

    it("rejects bodies over 100kb with 413", async () => {
      const { app } = setup();

      const res = await request(app)
        .post("/api/health")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ blob: "x".repeat(101 * 1024) }));

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
    });

    it("records the error code in the access log", async () => {
      const { app, find } = setup();

      await request(app).get("/nope");

      expect(find("request completed")[0]).toEqual(
        expect.objectContaining({ status: 404, errorCode: ERROR_CODES.NOT_FOUND, level: 40 }),
      );
    });
  });
});
