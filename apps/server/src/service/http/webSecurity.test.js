import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@classicade/shared";
import { PRODUCTION_ENV } from "../../testing/testConfig.js";
import { createTestApp } from "../../testing/testApp.js";

/** A fake built web app: index.html plus a hashed asset. `under` puts it below a folder of that name. */
function fakeWebBuild({ under = "" } = {}) {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "classicade-web-")), under);
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(
    path.join(dir, "index.html"),
    "<!doctype html><head><title data-server-head>ClassiCade</title></head><div id=root></div>",
  );
  writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log('app')");
  writeFileSync(path.join(dir, "favicon.svg"), "<svg/>");
  return dir;
}

const ALLOWED = "http://localhost:5173"; // TEST_ENV.ALLOWED_ORIGINS

describe("CSRF guard (ADR-010)", () => {
  it("refuses a state-changing request from another site", async () => {
    const { app } = createTestApp();

    const res = await request(app).post("/api/session/guest").set("Origin", "https://evil.example");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it("accepts the same request from our own origin, and from non-browser clients (no Origin)", async () => {
    const { app } = createTestApp();

    expect((await request(app).post("/api/session/guest").set("Origin", ALLOWED)).status).toBe(201);
    expect((await request(app).post("/api/session/guest")).status).toBe(201);
  });

  it("refuses non-JSON bodies on state-changing requests (forms cannot forge JSON cross-site)", async () => {
    const { app } = createTestApp();

    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "text/plain")
      .send("email=a@b.co&password=x");

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE);
  });

  it("leaves safe requests alone, whatever their origin", async () => {
    const { app } = createTestApp();

    expect((await request(app).get("/api/games").set("Origin", "https://evil.example")).status).toBe(200);
  });

  it("allows a cross-site-looking DELETE only from our origin", async () => {
    const { app } = createTestApp();

    expect((await request(app).delete("/api/session").set("Origin", "https://evil.example")).status).toBe(
      403,
    );
    expect((await request(app).delete("/api/session").set("Origin", ALLOWED)).status).toBe(204);
  });
});

describe("Content-Security-Policy", () => {
  it("allows only our own origin and forbids inline code, plugins and framing", async () => {
    const { app } = createTestApp();

    const csp = (await request(app).get("/api/health")).headers["content-security-policy"];

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("forbids framing in older browsers too", async () => {
    const { app } = createTestApp();

    expect((await request(app).get("/api/health")).headers["x-frame-options"]).toBe("DENY");
  });

  it("upgrades insecure requests in production only", async () => {
    const prod = createTestApp({
      env: PRODUCTION_ENV,
    });
    const dev = createTestApp();

    expect((await request(prod.app).get("/api/health")).headers["content-security-policy"]).toContain(
      "upgrade-insecure-requests",
    );
    expect((await request(dev.app).get("/api/health")).headers["content-security-policy"]).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});

describe("serving the web app", () => {
  it("serves index.html for app routes, so deep links work, and never caches it", async () => {
    const { app } = createTestApp({ env: { WEB_DIST_DIR: fakeWebBuild() } });

    for (const route of ["/", "/room/AB2CD3", "/profile"]) {
      const res = await request(app).get(route).set("Accept", "text/html");
      expect(res.status).toBe(200);
      expect(res.text).toContain("<div id=root>");
      expect(res.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("serves the app from a checkout below a dot-folder (e.g. ~/.worktrees/…)", async () => {
    const { app } = createTestApp({ env: { WEB_DIST_DIR: fakeWebBuild({ under: ".hidden/dist" }) } });

    const res = await request(app).get("/games/chess").set("Accept", "text/html");

    expect(res.status).toBe(200);
    expect(res.text).toContain("<title data-server-head>Play Chess with a friend on ClassiCade</title>");
  });

  it("caches hashed assets for a year, and revalidates other static files", async () => {
    const { app } = createTestApp({ env: { WEB_DIST_DIR: fakeWebBuild() } });

    const asset = await request(app).get("/assets/index-abc123.js");
    const icon = await request(app).get("/favicon.svg");

    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(icon.headers["cache-control"]).toBe("no-cache");
  });

  it.each([
    ["/assets/RpsBoard-old123.js", "text/javascript"],
    ["/assets/worker-old123.mjs", "text/javascript"],
    ["/assets/HeroArt-old123.css", "text/css"],
    ["/assets/logo-old123.png", "text/plain"],
    ["/assets/nested/RpsBoard-old123.js", "text/javascript"],
  ])(
    "answers a build file that is not there (%s) with a 404 of its own type, never the app (CC-181)",
    async (url, type) => {
      const { app } = createTestApp({ env: { WEB_DIST_DIR: fakeWebBuild() } });

      const res = await request(app).get(url).set("Accept", "*/*");

      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toBe(`${type}; charset=utf-8`);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.text).toBe("/* Not found: this file is not part of this version of the site. */\n");
    },
  );

  it("never repeats the requested path in a missing file's answer, so a URL cannot write script", async () => {
    const { app } = createTestApp({ env: { WEB_DIST_DIR: fakeWebBuild() } });

    const res = await request(app).get("/assets/x.js*/alert(1)//").set("Accept", "*/*");

    expect(res.status).toBe(404);
    expect(res.text).not.toContain("alert");
  });

  it("keeps API 404s as JSON instead of returning the app", async () => {
    const { app } = createTestApp({ env: { WEB_DIST_DIR: fakeWebBuild() } });

    const res = await request(app).get("/api/nope").set("Accept", "text/html");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("does not answer non-HTML requests with the app", async () => {
    const { app } = createTestApp({ env: { WEB_DIST_DIR: fakeWebBuild() } });

    expect((await request(app).get("/missing.png").set("Accept", "image/png")).status).toBe(404);
  });

  it("is off when no build is configured (API only)", async () => {
    const { app } = createTestApp();

    expect((await request(app).get("/").set("Accept", "text/html")).status).toBe(404);
  });
});
