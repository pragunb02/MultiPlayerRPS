import { test as plain } from "@playwright/test";
import { PHONE_HEADER_MAX_WIDTH, expect, header, test } from "./fixtures.js";
import {
  VIEWPORTS,
  expectNoLayoutProblems,
  findLayoutProblems,
  formatFinding,
  inflateNumbers,
  probeViewports,
  sortFindings,
} from "./layoutProbe.js";
import { STRESS, longNameAccount } from "./personas.js";

// The layout probe (CC-154). First on fixture pages, where we know what is broken, so we know it finds exactly that
// and nothing else. Then on the screens of today's app, at every viewport from a 320 px phone to a 1280 px laptop
// and at 200 % zoom, with the longest names and big numbers. A finding we have a ticket for and have not fixed yet
// is listed in KNOWN with that ticket (CC-154 D3); anything else fails, one line per finding.

const PHONE = { width: 320, height: 640 };

/** A page of our own, at 320 × 640, laid out by the real browser. */
async function fixture(page, body, { css = "", size = PHONE } = {}) {
  await page.setViewportSize(size);
  await page.setContent(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>fixture</title>
<style>
  html, body { margin: 0; font: 16px/1.4 sans-serif; color: #111; background: #fff; }
  button { font: inherit; color: #111; background: #ddd; border: 1px solid #555; padding: 0; }
  .free { position: absolute; }
  ${css}
</style></head><body><main>${body}</main></body></html>`);
}

const kindsAndNames = (findings) => findings.map(({ kind, element }) => `${kind} ${element.name}`).sort();

plain.describe("the probe on fixture pages", () => {
  plain("finds clipping, overflow, overlap and covered controls, and nothing else", async ({ page }) => {
    await fixture(
      page,
      `<p class="free" style="top: 0; left: 0; width: 80px; overflow: hidden; white-space: nowrap">A sentence too long for its box</p>
       <div class="free" style="position: fixed; top: 300px; left: 250px; width: 200px">Past the edge</div>
       <button class="free" style="top: 100px; left: 10px; width: 100px; height: 40px">One</button>
       <button class="free" style="top: 100px; left: 100px; width: 100px; height: 40px">Two</button>
       <button class="free" style="top: 420px; left: 10px; width: 120px; height: 40px">Covered</button>
       <div role="region" aria-label="Fixed bar" style="position: fixed; top: 400px; left: 0; width: 300px; height: 80px; background: #eee"></div>`,
    );

    const findings = await findLayoutProblems(page, { screen: "problems" });

    expect(kindsAndNames(findings)).toEqual([
      "clipped A sentence too long for its box",
      "covered Covered",
      "overflow Past the edge",
      "overlap One",
    ]);
    expect(findings.find(({ kind }) => kind === "overlap").other.name).toBe("Two");
    expect(findings.find(({ kind }) => kind === "covered").other.name).toBe("Fixed bar");
  });

  plain(
    "finds nothing on a page with none of them, and passes every documented exception",
    async ({ page }) => {
      await fixture(
        page,
        `<a href="#main" style="position: absolute; left: -999px">Skip to content</a>
       <p style="width: 80px">A sentence that wraps inside its box</p>
       <p class="name" aria-label="${STRESS.longestName}"><span>${STRESS.longestName}</span></p>
       <p>Read the <a href="#rules">rules</a> first.</p>
       <span class="visually-hidden">Said, not shown: ${STRESS.hinglish}</span>
       <label class="radio"><input type="radio" name="pick" class="native"> Rock</label>
       <div style="overflow-x: auto; width: 300px"><div style="width: 900px">A wide table that scrolls inside its box</div></div>
       <button style="width: 120px; height: 44px">Play</button>
       <div aria-hidden="true" style="position: fixed; inset: 0; pointer-events: none">✨ confetti</div>
       <div role="status" style="position: fixed; bottom: 0; left: 0; right: 0; pointer-events: none">Saved</div>`,
        {
          css: `.name { width: 120px; margin: 0; } .name span { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
              .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
              .native { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
              .radio { display: inline-block; padding: 12px; }`,
        },
      );

      expect((await findLayoutProblems(page, { screen: "clean" })).map(formatFinding)).toEqual([]);
    },
  );

  plain("a modal dialog covers the page behind it on purpose, and is itself checked", async ({ page }) => {
    await fixture(
      page,
      `<button style="width: 120px; height: 44px">Behind</button>
       <div style="position: fixed; inset: 0; background: rgb(0 0 0 / 0.5)"></div>
       <div role="dialog" aria-modal="true" aria-label="Leave the game?" style="position: fixed; top: 100px; left: 20px; width: 280px; background: #fff">
         <button class="free" style="top: 10px; left: 10px; width: 100px; height: 44px">Stay</button>
         <button class="free" style="top: 10px; left: 90px; width: 100px; height: 44px">Leave</button>
         <div style="height: 64px"></div>
       </div>`,
    );

    expect(
      kindsAndNames(await findLayoutProblems(page, { screen: "dialog", kinds: ["overlap", "covered"] })),
    ).toEqual(["overlap Stay"]);
  });

  plain("finds a page that scrolls sideways", async ({ page }) => {
    await fixture(page, `<div style="width: 400px">A row wider than the phone</div>`);

    const findings = await findLayoutProblems(page, { screen: "wide", kinds: ["page-scroll", "overflow"] });

    expect(kindsAndNames(findings)).toEqual(["overflow A row wider than the phone", "page-scroll "]);
    expect(findings.find(({ kind }) => kind === "page-scroll").detail).toBe(
      "the page is 400 px wide in a 320 px screen, so it scrolls sideways",
    );
  });

  plain(
    "finds tap targets under 24 px with another target close by, not spaced ones or links in a sentence",
    async ({ page }) => {
      await fixture(
        page,
        `<button class="free" style="top: 10px; left: 10px; width: 16px; height: 16px" aria-label="Close one"></button>
       <button class="free" style="top: 10px; left: 30px; width: 16px; height: 16px" aria-label="Close two"></button>
       <button class="free" style="top: 200px; left: 100px; width: 16px; height: 16px" aria-label="Alone"></button>
       <p class="free" style="top: 300px; font-size: 12px">See <a href="#more">more</a> below.</p>`,
      );

      expect(
        kindsAndNames(await findLayoutProblems(page, { screen: "targets", kinds: ["small-target"] })),
      ).toEqual(["small-target Close one", "small-target Close two"]);
    },
  );

  plain("finds text that fails contrast, in the theme it fails in", async ({ page }) => {
    await fixture(page, `<p class="faint">Waiting for your opponent</p>`, {
      css: `@media (prefers-color-scheme: dark) { body { background: #111; } .faint { color: #333; } }`,
    });

    const light = await findLayoutProblems(page, {
      screen: "faint",
      kinds: ["contrast"],
      colorScheme: "light",
    });
    const dark = await findLayoutProblems(page, {
      screen: "faint",
      kinds: ["contrast"],
      colorScheme: "dark",
    });

    expect(light).toEqual([]);
    expect(kindsAndNames(dark)).toEqual(["contrast Waiting for your opponent"]);
    expect(dark[0].detail).toMatch(/^color-contrast: Element has insufficient color contrast/);
  });

  plain(
    "an ellipsis on a name is allowed only when the whole name is in its accessible name (D4)",
    async ({ page }) => {
      const seat = (label) => `<p class="seat" ${label}><span class="cut">${STRESS.longestName}</span></p>`;
      await fixture(
        page,
        `${seat(`aria-label="${STRESS.longestName}"`)}${seat(`title="${STRESS.longestName}"`)}${seat("")}`,
        {
          css: `.seat { width: 120px; } .cut { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }`,
        },
      );

      const findings = await findLayoutProblems(page, { screen: "seats", kinds: ["clipped"] });

      expect(findings).toHaveLength(2);
      expect(findings[0].detail).toBe(
        `"${STRESS.longestName}" is cut off with an ellipsis, and the whole text is not in the accessible name`,
      );
    },
  );

  plain(
    "checks every viewport from 320 to 1280 px and 200 % zoom, and puts the page back",
    async ({ page }) => {
      // A row of 380 px: wider than the two smallest phones only.
      await fixture(page, `<div class="row">A row of 380 px</div>`, {
        css: `.row { width: 380px; }`,
        size: { width: 800, height: 600 },
      });

      const findings = await probeViewports(page, { screen: "row", kinds: ["page-scroll"] });

      expect(findings.map(({ viewport }) => viewport)).toEqual(["320", "360"]);
      expect(page.viewportSize()).toEqual({ width: 800, height: 600 });
      expect(VIEWPORTS.at(-1)).toEqual({ name: "200% zoom", width: 640, height: 360 });
    },
  );

  plain(
    "with stress data: the longest name, a long Hinglish line and six digit move numbers",
    async ({ page }) => {
      // The owner's bug (CC-154): a move number column sized for two digits shows only the last of three.
      await fixture(
        page,
        `<ol class="moves"><li><span class="number">10.</span> e4 e5</li></ol>
       <p class="line">${STRESS.hinglish}</p>
       <p class="name">${STRESS.longestName}</p>`,
        {
          css: `.moves { list-style: none; padding: 0; } .number { display: inline-block; width: 3.5ch; overflow: hidden; direction: rtl; }
              .line { width: 300px; } .name { width: 200px; overflow: hidden; }`,
        },
      );
      // The long line wraps; the name has nowhere to break and is cut; "10." still fits.
      expect(kindsAndNames(await findLayoutProblems(page, { screen: "moves", kinds: ["clipped"] }))).toEqual([
        `clipped ${STRESS.longestName}`,
      ]);

      expect(await inflateNumbers(page)).toBe(1);
      const findings = await findLayoutProblems(page, { screen: "moves", kinds: ["clipped"] });

      expect(kindsAndNames(findings)).toEqual([
        `clipped ${STRESS.bigNumber}.`,
        `clipped ${STRESS.longestName}`,
      ]);
    },
  );

  plain("a finding reads without the report", async ({ page }) => {
    await fixture(
      page,
      `<button class="free" style="top: 100px; left: 10px; width: 100px; height: 40px">One</button>
       <button class="free" style="top: 100px; left: 100px; width: 100px; height: 40px">Two</button>`,
    );

    const [finding] = await findLayoutProblems(page, { screen: "two buttons", kinds: ["overlap"] });

    expect(formatFinding(finding)).toBe(
      'overlap on two buttons at 320×640 (light): <button "One" .free> at 10,100 100×40 and <button "Two" .free> at 100,100 100×40: two controls overlap by 10×40 px',
    );
  });
});

// ---- The app's own screens ----

/**
 * What the probe found on the screens of main on 2026-10-21 that is not fixed yet (CC-154 D3). Each entry is the
 * kind, a pattern for the elements (as formatFinding writes them; CSS module classes end in a hash and a line number,
 * so only their start is matched), optionally the viewport, and the ticket that fixes it: the ticket that owns the
 * file in Wave 2 (docs/design/REDESIGN-PLAN.md section 2), since CC-154 may not edit those files. The pull request
 * that fixes one removes its entry.
 *
 * @type {import("./layoutProbe.js").KnownFailure[]}
 */
const KNOWN = [
  // The header's player area (Log in, Sign up, Feedback; or the inbox, level and name) does not fit between the
  // phone header (up to 640 px) and about 1100 px: past the right edge at 768 and 1024, so the page scrolls sideways.
  { kind: "overflow", element: /\._player_/, ticket: "CC-324" },
  { kind: "page-scroll", element: /^<html>$/, viewport: "768", ticket: "CC-324" },
  { kind: "page-scroll", element: /^<html>$/, viewport: "1024", ticket: "CC-324" },
  // On a phone browser the wider page widens the layout viewport, so the toast column, fixed to its right, goes
  // past the screen's edge with it.
  { kind: "overflow", element: /^<div role=status "[^"]*" \._region_/, ticket: "CC-324" },
  // At 320 px a signed-in player's Profile link runs under the Menu button in the phone header.
  { kind: "overlap", element: /"Profile"/, viewport: "320", ticket: "CC-324" },
  // A leaderboard row's "Hidden player" is cut with an ellipsis on phones, and the row's name says no more.
  { kind: "clipped", element: /"Hidden player" \._nameText_/, ticket: "CC-329" },
  // The profile's level ring cuts a six digit number.
  { kind: "clipped", element: /^<text "888,888" \._text_/, ticket: "CC-331" },
  // An achievement toast sits over the header's Sound button for its few seconds.
  { kind: "overlap", element: /\._toast_/, ticket: "CC-315" },
];

/** Probes the screen at every viewport with big numbers on it, and adds what it finds to `found`. */
async function probe(found, page, screen, { prepare } = {}) {
  found.push(
    ...(await probeViewports(page, {
      screen,
      prepare: async (current) => {
        await prepare?.(current);
        await inflateNumbers(current);
      },
    })),
  );
}

/** Checks everything a test found at once, so one run lists every finding, not just the first. */
function check(found, testInfo) {
  const { known } = sortFindings(found, KNOWN);
  for (const ticket of new Set(known.map((entry) => entry.ticket))) {
    testInfo.annotations.push({ type: "known layout failure", description: ticket });
  }
  expectNoLayoutProblems(found, { knownFailures: KNOWN });
}

const h1 = (page) => page.getByRole("heading", { level: 1 });

async function signUp(player, account) {
  await player.page.goto("/signup");
  await player.page.getByLabel("Username").fill(account.username);
  await player.page.getByLabel("Email").fill(account.email);
  await player.page.getByLabel("Password").fill(account.password);
  await player.page.getByRole("button", { name: "Create account" }).click();
  await expect(player.page).toHaveURL("/");
}

/** On a phone the header's controls sit in its menu: opens it, so they are probed too. */
const withMenuOpen = async (page) => {
  if (page.viewportSize().width <= PHONE_HEADER_MAX_WIDTH) await header(page);
};

test.describe("the probe on the app's screens", () => {
  test("a visitor's screens: nothing clipped, past the edge, overlapping or unreadable", async ({
    players,
  }, testInfo) => {
    test.setTimeout(240_000);
    const visitor = await players.open("visitor");
    visitor.expect(404, "/no/such/page");
    const { page } = visitor;
    const found = [];
    for (const [path, screen] of [
      ["/", "home (visitor)"],
      ["/login", "log in"],
      ["/signup", "sign up"],
      ["/games/rock-paper-scissors", "Rock Paper Scissors lobby"],
      ["/games/chess", "chess lobby"],
      ["/leaderboards/overall", "leaderboard"],
      ["/no/such/page", "page not found"],
    ]) {
      await page.goto(path);
      await expect(h1(page)).toBeVisible();
      await page.waitForLoadState("networkidle");
      await probe(found, page, screen);
    }
    check(found, testInfo);
  });

  test("the longest names fit every place a name shows", async ({ players }, testInfo) => {
    test.setTimeout(300_000);
    const hostAccount = longNameAccount();
    const guestAccount = longNameAccount();
    const host = await players.open("host", { secrets: [hostAccount.email, hostAccount.password] });
    const guest = await players.open("guest", { secrets: [guestAccount.email, guestAccount.password] });
    await signUp(host, hostAccount);
    await signUp(guest, guestAccount);
    const found = [];

    await probe(found, host.page, "home (account)", { prepare: withMenuOpen });

    await host.page.goto("/games/rock-paper-scissors");
    await host.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
    await host.page.getByRole("button", { name: "Create room" }).click();
    const invite = await host.page.getByRole("textbox", { name: "Invite link" }).inputValue();
    await probe(found, host.page, "room waiting");

    await guest.page.goto(invite);
    const choices = (player) => player.page.getByRole("group", { name: "Your choice" });
    for (const player of [host, guest]) {
      await expect(choices(player).getByRole("button", { name: /Rock/ })).toBeVisible();
    }
    await probe(found, host.page, "room playing (host)");
    await probe(found, guest.page, "room playing (guest)");

    await choices(host).getByRole("button", { name: /Rock/ }).click();
    await choices(guest)
      .getByRole("button", { name: /Scissors/ })
      .click();
    await expect(host.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
    await expect(guest.page.getByRole("heading", { name: /^You lost/ })).toBeVisible();
    await probe(found, host.page, "result (won)");
    await probe(found, guest.page, "result (lost)");

    await host.page.goto("/leaderboards/overall");
    await expect(host.page.getByRole("heading", { name: "Overall XP", exact: true })).toBeVisible();
    await host.page.waitForLoadState("networkidle");
    await probe(found, host.page, "leaderboard (account)");

    await host.page.goto("/profile");
    await expect(h1(host.page)).toHaveText(hostAccount.username);
    await host.page.waitForLoadState("networkidle");
    await probe(found, host.page, "profile");

    check(found, testInfo);
  });
});
