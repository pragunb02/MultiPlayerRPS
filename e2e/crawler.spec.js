import { createRoom, expect, test } from "./fixtures.js";

// Search engines and the bots that draw link previews in chat apps (CC-047). They fetch the raw HTML with no
// cookies and run no scripts, so everything they need must already be in what the server sends.

/** The raw HTML of a page, as a crawler fetches it. */
async function crawl(request, url) {
  const res = await request.get(url, { headers: { Accept: "text/html" }, maxRedirects: 0 });
  return { status: res.status(), html: await res.text() };
}

/** The content of a head tag, read from raw HTML, or undefined. */
function tag(html, attribute, name) {
  return html.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`))?.[1];
}

test.describe("crawler and link preview bot", () => {
  test("sees a game link's own title, description, canonical URL and preview image", async ({
    request,
    baseURL,
  }) => {
    const { status, html } = await crawl(request, "/games/chess");

    expect(status).toBe(200);
    expect(tag(html, "property", "og:title")).toBe("Play Chess with a friend on ClassiCade");
    expect(tag(html, "name", "description")).toContain("Chess");
    expect(html).toContain(`<link rel="canonical" href="${baseURL}/games/chess"`);
    expect(tag(html, "name", "twitter:card")).toBe("summary_large_image");
    const image = await request.get(tag(html, "property", "og:image"));
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/jpeg");
  });

  test("reads the page's own title and description as the first words of the body, before the loading screen", async ({
    request,
  }) => {
    const { html } = await crawl(request, "/leaderboards/overall");

    // What a crawler that runs no scripts takes for the page's text: the body, without its tags.
    const words = html
      .slice(html.indexOf("<body>"))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const title = tag(html, "property", "og:title");
    const description = tag(html, "name", "description");
    expect(words.startsWith(`${title} ${description}`)).toBe(true);
    expect(html).toContain(`<h1 class="wake-page" data-server-body="title">${title}</h1>`);
  });

  test("previews a friend's invite link as an invitation to that game, without joining the room", async ({
    players,
    request,
  }) => {
    const host = await players.open("host");
    const room = await createRoom(host, "chess");

    const { status, html } = await crawl(request, room.invite);

    expect(status).toBe(200);
    expect(html).toContain("<title data-server-head>Join my Chess game on ClassiCade</title>");
    expect(tag(html, "property", "og:title")).toBe("Join my Chess game on ClassiCade");
    expect(tag(html, "property", "og:url")).toBe(new URL(room.path, room.invite).href);
    expect(tag(html, "property", "og:image")).toMatch(/\/og\/chess\.[0-9a-f]{8}\.jpg$/);
    expect(tag(html, "name", "robots")).toBe("noindex");
    // The preview neither took a seat nor said anything about who is in the room.
    await expect(host.page.getByRole("heading", { name: "Invite a friend" })).toBeVisible();
    expect(html).not.toContain("Guest-");
  });

  test("is told what to crawl and which pages to list, never rooms", async ({ request, baseURL }) => {
    const robots = await request.get("/robots.txt");
    const sitemap = await request.get("/sitemap.xml");

    expect(await robots.text()).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
    const listed = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((found) => found[1]);
    expect(listed).toContain(`${baseURL}/games/chess`);
    expect(listed).toContain(`${baseURL}/privacy`);
    expect(listed.some((url) => url.includes("/rooms/"))).toBe(false);
  });

  test("gets a real 404 for a page that does not exist, still with the app for people", async ({
    request,
  }) => {
    const { status, html } = await crawl(request, "/no/such/page");

    expect(status).toBe(404);
    expect(html).toContain('<div id="root">');
    expect(tag(html, "name", "robots")).toBe("noindex");
  });
});
