import { test as base, expect } from "@playwright/test";
import {
  isCancelledRequest,
  isEngineOwnMessage,
  isFailedLoadMessage,
  isFetchRefusedWhileLeaving,
  isRealtimeDownMessage,
} from "./browserNoise.js";

/**
 * `players.open(name)` gives a person their own browser (own cookies), as Render serves it: behind HTTPS, so the
 * production session cookie (`Secure`) works on localhost. Everything the browser sees is recorded, and after the
 * test each player's record must be clean:
 *
 * - no console errors or warnings, no uncaught page errors, no CSP violations, no failed requests
 *   (except the ones a test declares with `player.expect(status, path)`);
 * - no secret in any URL the browser requested or showed: passwords, emails, the session cookie;
 * - the session cookie is HttpOnly (not readable by page scripts), and web storage holds only allowlisted
 *   preferences (STORAGE_ALLOWLIST, CC-103).
 *
 * A test that restarts the server declares it with `player.expectRestart()`. Then the realtime connection may
 * fail while the next server process starts, and only that (CC-101).
 */
/**
 * The only things the app may keep in web storage, with the exact shape each must have. A preference of this browser
 * (is sound on, how loud) is fine there. Anything that identifies the player or a game is not, because page scripts
 * can read web storage and it outlives the session (CC-103).
 */
export const STORAGE_ALLOWLIST = Object.freeze({
  "cc.sound": isSoundSetting,
  // The usage counts switch (CC-174): only ever "off", and only when the player turned counts off.
  "cc.telemetry": (raw) => raw === "off",
});

/** The kinds of notice whose sound is set apart (CC-208, lib/notify/categories.js). */
const SOUND_CATEGORIES = Object.freeze(["request", "turn", "result", "reward", "social", "system"]);
const isVolume = (value) => typeof value === "number" && value >= 0 && value <= 1;

/**
 * The sound setting: muted and the volume, and since CC-208 the same two for each kind of notice. Nothing else may
 * be in it, so nothing about a player or a game can hide there.
 */
function isSoundSetting(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return false;
  }
  const keys = Object.keys(value ?? {});
  const categories = value?.categories ?? {};
  return (
    keys.every((key) => ["muted", "volume", "categories"].includes(key)) &&
    typeof value.muted === "boolean" &&
    isVolume(value.volume) &&
    Object.entries(categories).every(
      ([id, setting]) =>
        SOUND_CATEGORIES.includes(id) &&
        Object.keys(setting).length === 2 &&
        typeof setting.on === "boolean" &&
        isVolume(setting.volume),
    )
  );
}

export const test = base.extend({
  players: async ({ browser, baseURL }, use, testInfo) => {
    const opened = [];
    // Playwright records a video only of its own `page`, not of the browsers opened here. So when a project asks
    // for video (the visual baselines, CC-155), each person's browser is recorded here, and the recording is kept
    // only when the test fails.
    const recordVideo = wantsVideo(testInfo) ? { dir: testInfo.outputPath("videos") } : undefined;

    async function open(name, { secrets = [] } = {}) {
      const context = await browser.newContext({
        baseURL,
        // The certificate is made for this run only (tlsFront.js). Test code only, the app is unchanged.
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { "X-Forwarded-Proto": "https" },
        recordVideo,
      });
      const page = await context.newPage();
      const record = { problems: [], urls: [], socketFrames: [], expected: [] };
      const isExpected = (status, url) =>
        record.expected.some((e) => e.status === status && new URL(url).pathname === e.path);
      // While the server restarts, the browser's realtime connection fails until the next process is up, and
      // the browser reports each attempt. That is the expected cost of a restart, and the only one (CC-101).
      const isRestartNoise = (url) => record.restarting && new URL(url).pathname.startsWith("/socket.io/");
      const engine = browser.browserType().name();

      // Every tab of the person's browser is recorded the same way, so a second tab is checked as the first.
      const watch = (tab) => {
        tab.on("console", (message) => {
          if (message.type() !== "error" && message.type() !== "warning") return;
          // The browser logs every failed request as a console error; those are judged by status below.
          if (isFailedLoadMessage(message.text())) return;
          if (record.restarting && isRealtimeDownMessage(message.text())) return;
          if (isEngineOwnMessage(engine, message.text())) return;
          record.problems.push(`console.${message.type()}: ${message.text()}`);
        });
        tab.on("pageerror", (error) => {
          if (isFetchRefusedWhileLeaving(engine, error.stack ?? "", new URL(baseURL).origin)) return;
          record.problems.push(`page error: ${error.message}`);
        });
        tab.on("request", (request) => record.urls.push(request.url()));
        tab.on("framenavigated", (frame) => frame === tab.mainFrame() && record.urls.push(frame.url()));
        tab.on("response", (response) => {
          if (response.status() >= 400 && !isExpected(response.status(), response.url())) {
            record.problems.push(
              `HTTP ${response.status()} ${response.request().method()} ${response.url()}`,
            );
          }
        });
        tab.on("requestfailed", (request) => {
          const reason = request.failure()?.errorText ?? "";
          // Navigating away cancels in-flight requests and closes sockets; that is not a failure.
          if (!isCancelledRequest(reason) && !isRestartNoise(request.url()))
            record.problems.push(`request failed: ${request.url()} ${reason}`);
        });
        tab.on("websocket", (socket) =>
          socket.on("framereceived", (frame) => record.socketFrames.push(String(frame.payload))),
        );
        return tab;
      };
      watch(page);

      const player = {
        name,
        page,
        context,
        record,
        secrets,
        /** Opens another tab in the same browser (same cookies), recorded and checked like the first (CC-115). */
        openTab: async () => watch(await context.newPage()),
        /** Declare a failure the test provokes on purpose, e.g. a wrong password → 401 on /api/auth/login. */
        expect: (status, path) => record.expected.push({ status, path }),
        /** Declare that the server restarts during this test, so the dropped realtime connection is expected. */
        expectRestart: () => {
          record.restarting = true;
        },
        /** The person closes their browser: checks run now, while it can still be inspected. */
        leave: async () => {
          await checkClean(player);
          player.closed = true;
          await context.close();
        },
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

    let clean = false;
    try {
      for (const player of opened.filter((p) => !p.closed)) {
        await checkClean(player);
        await player.context.close();
      }
      clean = true;
    } finally {
      if (recordVideo) {
        await keepVideosOfFailure({
          opened,
          testInfo,
          failed: !clean || testInfo.status !== testInfo.expectedStatus,
        });
      }
    }
  },
});

/** Whether the project records video (`use.video` set and not "off"). */
function wantsVideo(testInfo) {
  const { video } = testInfo.project.use;
  const mode = typeof video === "object" ? video.mode : video;
  return mode !== undefined && mode !== "off";
}

/**
 * Attaches each person's video to the report when the test failed, and deletes them when it passed. A recording
 * is written when its browser closes, so every browser is closed first.
 */
async function keepVideosOfFailure({ opened, testInfo, failed }) {
  for (const player of opened) {
    await player.context.close();
    const video = player.page.video();
    if (failed) {
      await testInfo.attach(`video of ${player.name}`, {
        path: await video.path(),
        contentType: "video/webm",
      });
    } else {
      await video.delete();
    }
  }
}

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
  // The first tab, and any other tab the test opened in this browser (openTab).
  for (const tab of new Set([page, ...context.pages()])) {
    await checkStorage({ name, tab });
  }
}

async function checkStorage({ name, tab }) {
  if (!tab.isClosed() && tab.url().startsWith("http")) {
    const exposed = await tab.evaluate(() => ({
      cookie: document.cookie,
      local: Object.entries(localStorage),
      session: Object.keys(sessionStorage),
    }));
    expect(exposed.cookie, `${name}: page scripts can read cookies`).not.toContain("cc.sid");
    for (const [key, value] of exposed.local) {
      const allowed = Object.hasOwn(STORAGE_ALLOWLIST, key) && STORAGE_ALLOWLIST[key](value);
      expect(
        allowed,
        `${name}: localStorage holds ${key}=${value}, which is not an allowlisted preference`,
      ).toBe(true);
    }
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

/**
 * Opens a room link without a session and chooses to play as a guest (CC-086: nobody becomes a guest without
 * choosing to).
 */
export async function joinAsGuest(player, path) {
  await player.page.goto(path);
  await player.page.getByRole("button", { name: "Play as guest" }).click();
}

/** Creates a room in `gameSlug` from its lobby and returns the room URL (path) and code. */
export async function createRoom(player, gameSlug) {
  await player.page.goto(`/games/${gameSlug}`);
  await player.page.getByRole("button", { name: "Create room" }).click();
  await player.page.getByRole("heading", { name: "Waiting for a friend to join" }).waitFor();
  const invite = await player.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  const { pathname } = new URL(invite);
  return { invite, path: pathname, code: pathname.split("/").pop() };
}

/**
 * Whether this run is on a phone or a laptop, whatever the browser engine. Tests that differ by screen or by
 * input (touch, keyboard) ask this instead of the project's name, so a new engine's project needs no changes there.
 *
 * @param {import("@playwright/test").TestInfo} testInfo
 * @returns {"mobile" | "desktop"}
 */
export const formFactor = (testInfo) => (testInfo.project.use.isMobile ? "mobile" : "desktop");

/**
 * The key that moves to the next control. Safari's Tab reaches only form fields unless the player turns on "Press
 * Tab to highlight each item". Option and Tab reaches links too, and that is the key a Safari keyboard user
 * presses (CC-184).
 *
 * @param {import("@playwright/test").TestInfo} testInfo
 */
export const nextItemKey = (testInfo) =>
  testInfo.project.use.defaultBrowserType === "webkit" ? "Alt+Tab" : "Tab";

/**
 * Presses the next-control key until `target` has the focus, at most `presses` times, as a keyboard player would.
 *
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} target
 * @param {import("@playwright/test").TestInfo} testInfo
 */
export async function tabUntil(page, target, testInfo, presses = 20) {
  for (let press = 0; press < presses; press++) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press(nextItemKey(testInfo));
  }
  await expect(target).toBeFocused();
}

/** The widest screen, in CSS pixels, that gets the phone header: 40rem in Layout.module.css. */
export const PHONE_HEADER_MAX_WIDTH = 640;

/**
 * The header, with the player's controls on screen (sound, level, name, Log in, Sign up, Log out). On a phone they
 * sit in the header's menu (CC-259), so this opens it first when it is closed. The menu closes on every new page,
 * so call this again after the page changes.
 *
 * @param {import("@playwright/test").Page} page
 */
export async function header(page) {
  const banner = page.getByRole("banner");
  if (page.viewportSize().width <= PHONE_HEADER_MAX_WIDTH) {
    const toggle = banner.getByRole("button", { name: "Menu" });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  return banner;
}

export { expect };
