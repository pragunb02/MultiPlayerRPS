import { test as base, expect } from "@playwright/test";

/**
 * `players.open(name)` gives a person their own browser (own cookies), as Render serves it: behind HTTPS, so the
 * production session cookie (`Secure`) works on localhost. Everything the browser sees is recorded, and after the
 * test each player's record must be clean:
 *
 * - no console errors or warnings, no uncaught page errors, no CSP violations, no failed requests
 *   (except the ones a test declares with `player.expect(status, path)`);
 * - no secret in any URL the browser requested or showed: passwords, emails, the session cookie;
 * - the session cookie is HttpOnly (not readable by page scripts), and nothing is kept in web storage.
 */
export const test = base.extend({
  players: async ({ browser, baseURL }, use) => {
    const opened = [];

    async function open(name, { secrets = [] } = {}) {
      const context = await browser.newContext({
        baseURL,
        extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
      });
      const page = await context.newPage();
      const record = { problems: [], urls: [], socketFrames: [], expected: [] };
      const isExpected = (status, url) =>
        record.expected.some((e) => e.status === status && new URL(url).pathname === e.path);

      page.on("console", (message) => {
        if (message.type() !== "error" && message.type() !== "warning") return;
        // The browser logs every failed request as a console error; those are judged by status below.
        if (/Failed to load resource/.test(message.text())) return;
        record.problems.push(`console.${message.type()}: ${message.text()}`);
      });
      page.on("pageerror", (error) => record.problems.push(`page error: ${error.message}`));
      page.on("request", (request) => record.urls.push(request.url()));
      page.on("framenavigated", (frame) => frame === page.mainFrame() && record.urls.push(frame.url()));
      page.on("response", (response) => {
        if (response.status() >= 400 && !isExpected(response.status(), response.url())) {
          record.problems.push(`HTTP ${response.status()} ${response.request().method()} ${response.url()}`);
        }
      });
      page.on("requestfailed", (request) => {
        const reason = request.failure()?.errorText ?? "";
        // Navigating away cancels in-flight requests and closes sockets; that is not a failure.
        if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(reason))
          record.problems.push(`request failed: ${request.url()} ${reason}`);
      });
      page.on("websocket", (socket) =>
        socket.on("framereceived", (frame) => record.socketFrames.push(String(frame.payload))),
      );

      const player = {
        name,
        page,
        context,
        record,
        secrets,
        /** Declare a failure the test provokes on purpose, e.g. a wrong password → 401 on /api/auth/login. */
        expect: (status, path) => record.expected.push({ status, path }),
        /** The address bar: path and query. */
        url: () => {
          const { pathname, search } = new URL(page.url());
          return `${pathname}${search}`;
        },
      };
      opened.push(player);
      return player;
    }

    await use({ open });

    for (const player of opened) {
      await checkClean(player);
      await player.context.close();
    }
  },
});

async function checkClean({ name, page, context, record, secrets }) {
  expect(record.problems, `${name}: console, page errors, CSP and failed requests`).toEqual([]);

  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "cc.sid");
  const leaks = [...secrets, ...(session ? [session.value] : [])].filter((secret) => secret !== "");
  for (const url of record.urls) {
    const decoded = safeDecode(url);
    for (const secret of leaks) {
      expect(decoded.includes(secret), `${name}: a secret appeared in the URL ${url}`).toBe(false);
    }
  }
  if (session) {
    expect(session.httpOnly, `${name}: session cookie must be HttpOnly`).toBe(true);
    expect(session.secure, `${name}: session cookie must be Secure`).toBe(true);
    expect(session.sameSite, `${name}: session cookie must be SameSite=Lax`).toBe("Lax");
  }
  if (!page.isClosed() && page.url().startsWith("http")) {
    const exposed = await page.evaluate(() => ({
      cookie: document.cookie,
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    }));
    expect(exposed.cookie, `${name}: page scripts can read cookies`).not.toContain("cc.sid");
    expect(exposed.local, `${name}: localStorage`).toEqual([]);
    expect(exposed.session, `${name}: sessionStorage`).toEqual([]);
  }
}

function safeDecode(url) {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/** Creates a room in `gameSlug` from its lobby and returns the room URL (path) and code. */
export async function createRoom(player, gameSlug) {
  await player.page.goto(`/games/${gameSlug}`);
  await player.page.getByRole("button", { name: "Create room" }).click();
  await player.page.getByRole("heading", { name: "Invite a friend" }).waitFor();
  const invite = await player.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  const { pathname } = new URL(invite);
  return { invite, path: pathname, code: pathname.split("/").pop() };
}

export { expect };
