import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { GAMES, gamePreviewImage, getGame, PUBLIC_PAGE_PATHS, SITE_PREVIEW_IMAGE } from "@classicade/shared";
import { createTestApp } from "../../testing/testApp.js";
import { TEST_WEB_BUILD } from "../../testing/testConfig.js";
import { createWebAppRouter } from "./webApp.js";

const ORIGIN = "https://classicade.example";
const CHESS_IMAGE = gamePreviewImage(getGame("chess"));
// WhatsApp reads the head only within the first 300 KB of the page (CC-217).
const HEAD_LIMIT_BYTES = 300 * 1024;

/** Nobody is an admin unless a test says so (CC-233). The session is faked by a header. */
const ADMIN_PAGE = Object.freeze({
  sessionMiddleware: (req, res, next) => {
    req.session = req.get("X-Test-Admin") === "yes" ? { admin: true } : {};
    next();
  },
  isAdmin: (sessionData) => sessionData.admin === true,
});

function webApp() {
  return express().use(
    createWebAppRouter({ distDir: TEST_WEB_BUILD, siteOrigin: ORIGIN, adminPage: ADMIN_PAGE }),
  );
}

/** The raw HTML a crawler gets: it sends no cookies and runs no scripts. */
const crawl = (path) => request(webApp()).get(path).set("Accept", "text/html");

/** The content of the head tag with this attribute and value, or undefined. */
function tag(html, attribute, name) {
  const found = html.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`));
  return found?.[1];
}

describe("page head for crawlers and link previews", () => {
  it("previews an invite link with the game it names, its image and its own URL", async () => {
    const res = await crawl("/games/chess/rooms/ab2cd3");

    expect(res.status).toBe(200);
    expect(res.text).toContain("<title data-server-head>Join my Chess game on ClassiCade</title>");
    expect(tag(res.text, "property", "og:title")).toBe("Join my Chess game on ClassiCade");
    expect(tag(res.text, "property", "og:url")).toBe(`${ORIGIN}/games/chess/rooms/AB2CD3`);
    expect(tag(res.text, "property", "og:image")).toBe(`${ORIGIN}${CHESS_IMAGE}`);
    expect(tag(res.text, "name", "twitter:card")).toBe("summary_large_image");
    expect(tag(res.text, "name", "twitter:image")).toBe(`${ORIGIN}${CHESS_IMAGE}`);
    expect(tag(res.text, "name", "robots")).toBe("noindex");
    expect(res.text).not.toContain('rel="canonical"');
  });

  it("previews each game's lobby with its name and lists it under its canonical URL", async () => {
    for (const game of GAMES) {
      const res = await crawl(`/games/${game.slug}`);

      expect(res.status).toBe(200);
      expect(tag(res.text, "property", "og:title")).toBe(`Play ${game.name} with a friend on ClassiCade`);
      expect(tag(res.text, "name", "description")).toContain(game.name);
      expect(res.text).toContain(
        `<link rel="canonical" href="${ORIGIN}/games/${game.slug}" data-server-head>`,
      );
      expect(tag(res.text, "name", "robots")).toBeUndefined();
    }
  });

  it("previews a shared link like the clean page, so the channel marker never makes a second page (CC-279)", async () => {
    for (const via of ["wa", "share", "copy", "unknown"]) {
      const game = await crawl(`/games/chess?via=${via}`);
      const room = await crawl(`/games/chess/rooms/AB2CD3?via=${via}`);

      expect(game.status).toBe(200);
      expect(tag(game.text, "property", "og:url")).toBe(`${ORIGIN}/games/chess`);
      expect(game.text).toContain(`<link rel="canonical" href="${ORIGIN}/games/chess" data-server-head>`);
      expect(room.status).toBe(200);
      expect(tag(room.text, "property", "og:url")).toBe(`${ORIGIN}/games/chess/rooms/AB2CD3`);
      expect(tag(room.text, "name", "robots")).toBe("noindex");
    }
  });

  it("previews a room of a game this build does not know in general words, without asking whether it exists", async () => {
    const res = await crawl("/games/ludo/rooms/ZZ9ZZ9");

    expect(res.status).toBe(200);
    expect(tag(res.text, "property", "og:title")).toBe("Join my game on ClassiCade");
    expect(tag(res.text, "property", "og:image")).toBe(`${ORIGIN}${SITE_PREVIEW_IMAGE}`);
  });

  it("replaces the build's default title and description instead of adding a second one", async () => {
    const res = await crawl("/privacy");

    expect(res.text.match(/<title/g)).toHaveLength(1);
    expect(res.text.match(/name="description"/g)).toHaveLength(1);
    expect(res.text).not.toContain("Default description");
    expect(res.text).toContain("<title data-server-head>Privacy policy · ClassiCade</title>");
    // The head is still well formed, with the new tags inside it.
    expect(res.text.indexOf("og:title")).toBeLessThan(res.text.indexOf("</head>"));
  });

  it("puts the page's own title and description in the body, for crawlers that read the body text", async () => {
    const res = await crawl("/games/chess");
    const description = tag(res.text, "name", "description");

    const body = res.text.slice(res.text.indexOf("<body>"));
    expect(body).toContain('<h1 data-server-body="title">Play Chess with a friend on ClassiCade</h1>');
    expect(body).toContain(`<p data-server-body="description">${description}</p>`);
  });

  it("escapes what came from the URL, so a crafted link cannot add markup", async () => {
    const res = await crawl("/games/%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E/rooms/AB2CD3");

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<script>");
    expect(res.text).not.toContain("alert(1)");
  });

  it.each([
    "/no/such/page",
    "/games/ludo",
    "/games/chess/rooms/not-a-code",
    "/leaderboards/nope",
    "/%E0%A4%A",
  ])("answers 404 with the app, which shows its not found page, at %s", async (path) => {
    const res = await crawl(path);

    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.text).toContain('<div id="root">');
    expect(res.text).toContain("<title data-server-head>Page not found · ClassiCade</title>");
    expect(tag(res.text, "name", "robots")).toBe("noindex");
  });

  it("answers 200 at the old URLs the app still sends on", async () => {
    for (const path of ["/play/rps", "/room/ab2cd3", "/login-signup.html", "/u/Old%20Timer!/userprofile"]) {
      expect((await crawl(path)).status, path).toBe(200);
    }
  });
});

describe("the owner console's pages (CC-233)", () => {
  it.each(["/admin", "/admin/players", "/admin/retention/", "/admin/ux", "/admin/ux/week"])(
    "are an unknown address, 404 with the not found page, to anyone but an admin: %s",
    async (path) => {
      const res = await crawl(path);

      expect(res.status).toBe(404);
      expect(res.text).toContain("<title data-server-head>Page not found · ClassiCade</title>");
    },
  );

  it("answer an admin with the app, never cached and never listed", async () => {
    const res = await crawl("/admin/games").set("X-Test-Admin", "yes");

    expect(res.status).toBe(200);
    expect(res.text).toContain("<title data-server-head>Owner console · ClassiCade</title>");
    expect(tag(res.text, "name", "robots")).toBe("noindex");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("leave a request that does not want a page to the routes after them", async () => {
    const res = await request(webApp())
      .get("/admin")
      .set("Accept", "application/json")
      .set("X-Test-Admin", "yes");

    expect(res.status).toBe(404);
  });

  it("do not include deeper addresses, except the UX page's sections (CC-177)", async () => {
    expect((await crawl("/admin/players/extra").set("X-Test-Admin", "yes")).status).toBe(404);
    expect((await crawl("/admin/ux/week/extra").set("X-Test-Admin", "yes")).status).toBe(404);
    expect((await crawl("/admin/ux/funnels").set("X-Test-Admin", "yes")).status).toBe(200);
  });
});

describe("robots.txt and sitemap.xml", () => {
  it("lets crawlers see every page except the API, and points them at the sitemap", async () => {
    const res = await request(webApp()).get("/robots.txt");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.text).toBe(`User-agent: *\nDisallow: /api/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  });

  it("lists the public pages with absolute URLs, and no rooms", async () => {
    const res = await request(webApp()).get("/sitemap.xml");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/xml/);
    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((found) => found[1]);
    expect(locs).toEqual(PUBLIC_PAGE_PATHS.map((path) => `${ORIGIN}${path}`));
    expect(res.text).not.toContain("/rooms/");
  });

  it("lets them be cached for an hour", async () => {
    for (const path of ["/robots.txt", "/sitemap.xml"]) {
      expect((await request(webApp()).get(path)).headers["cache-control"]).toBe("public, max-age=3600");
    }
  });
});

describe("the site's own address", () => {
  it("is the first allowed origin", async () => {
    const { app } = createTestApp({
      env: { WEB_DIST_DIR: TEST_WEB_BUILD, ALLOWED_ORIGINS: "https://one.example,https://two.example" },
    });

    const res = await request(app).get("/games/chess").set("Accept", "text/html");

    expect(tag(res.text, "property", "og:url")).toBe("https://one.example/games/chess");
  });

  it("never comes from the request's own headers, which anyone can set (CC-217)", async () => {
    const res = await crawl("/games/chess")
      .set("Host", "evil.example")
      .set("X-Forwarded-Host", "evil.example")
      .set("X-Forwarded-Proto", "http")
      .set("Origin", "https://evil.example");

    expect(tag(res.text, "name", "classicade:site-origin")).toBe(ORIGIN);
    expect(tag(res.text, "property", "og:url")).toBe(`${ORIGIN}/games/chess`);
    expect(tag(res.text, "property", "og:image")).toBe(`${ORIGIN}${CHESS_IMAGE}`);
    expect(res.text).not.toContain("evil.example");
  });

  it("is written into every page for the app's share links, and the head ends inside the first 300 KB", async () => {
    for (const path of ["/", "/games/chess", "/games/chess/rooms/AB2CD3", "/no/such/page"]) {
      const res = await crawl(path);

      expect(tag(res.text, "name", "classicade:site-origin"), path).toBe(ORIGIN);
      expect(Buffer.byteLength(res.text.slice(0, res.text.indexOf("</head>")))).toBeLessThan(
        HEAD_LIMIT_BYTES,
      );
    }
  });
});
