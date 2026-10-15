import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { GAMES } from "@classicade/shared";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { errorHandler } from "./http/middleware/errors.js";

const app = createApp({ config: loadConfig({ NODE_ENV: "test" }) });

describe("HTTP app", () => {
  it("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/games returns the shared catalog", async () => {
    const res = await request(app).get("/api/games");
    expect(res.status).toBe(200);
    expect(res.body.games).toEqual(GAMES);
  });

  it("sets security headers and hides the framework", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("returns JSON 404 for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  it("returns JSON 400 for malformed JSON bodies", async () => {
    const res = await request(app).post("/api/health").set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

describe("errorHandler", () => {
  const run = (err) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    errorHandler(err, {}, res, () => {});
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  };

  it("hides internal error details", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = run(new Error("db password is hunter2"));
    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: "INTERNAL", message: "Internal server error" } });
    spy.mockRestore();
  });

  it("passes through exposed client error messages", () => {
    const err = Object.assign(new Error("Too large"), { status: 413, expose: true });
    expect(run(err)).toEqual({ status: 413, body: { error: { code: "BAD_REQUEST", message: "Too large" } } });
  });
});
