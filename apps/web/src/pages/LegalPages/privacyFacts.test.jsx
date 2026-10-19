import { readFileSync } from "node:fs";
import path from "node:path";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../testing/render.jsx";

/** Collapses every run of spaces, so a sentence matches however Prettier wrapped or padded it. */
const flat = (text) => text.replace(/\s+/g, " ");

// A path, not a URL: in the browser-like test environment `URL` is the page's own, which node:fs does not accept.
const DATA_MD = flat(readFileSync(path.join(import.meta.dirname, "../../../../../docs/DATA.md"), "utf8"));

/**
 * Every fact the privacy page states about what is stored, written once as a pair: a sentence in docs/DATA.md, the
 * inventory checked against the code, and the words on the page that say it to players. When DATA.md changes a
 * time or a store, its sentence here stops matching and this test fails until the page says the new thing (CC-248).
 */
const FACTS = [
  {
    fact: "a daily puzzle day is stored from the first move or hint until the account is deleted (CC-144)",
    data: "| [`daily_puzzle_attempts`](#daily_puzzle_attempts) | pseudonymous: player id, how each day's puzzle went | until the account is deleted |",
    page: /When you make a move or take a hint in a daily puzzle, we store how that day's puzzle went for you.*until you delete your account\. Just looking at a puzzle stores nothing/,
  },
  {
    fact: "rooms are stored in MongoDB for 30 minutes to 24 hours",
    data: "| [`rooms`](#rooms) | pseudonymous: ids, names, every move, network hash | 30 minutes to 24 hours after the last activity",
    page: /While a room is open we store it in our database.*30 minutes to 24 hours after the last activity/,
  },
  {
    fact: "a closed room leaves a record for 24 hours",
    data: "| [`closed_rooms`](#closed_rooms) | no | 24 hours |",
    page: /A short note that the room closed \(its code, game and why\) stays for 24 hours/,
  },
  {
    fact: "the room's network hash uses a random key that changes every UTC day",
    data: "It names new rooms during that day. During the next day it is kept only to count the rooms opened under it",
    page: /a key that is random, kept only in the server's memory and replaced every day \(UTC\)\. A key names rooms for one day, is kept one more day only to count them, and is then deleted/,
  },
  {
    fact: "the login throttle remembers networks for 30 days, as keyed hashes",
    data: "failures 15 minutes, known addresses 30 days",
    page: /remembers for 30 days which networks signed in to each account, up to 10 per account/,
  },
  {
    fact: "the login throttle keeps no plain email or address",
    data: "Only keyed hashes are kept, never the email or the address",
    page: /keyed hashes made with a random key, never the email or the address itself/,
  },
  {
    fact: "the HTTP rate limits keep addresses for 1 minute to 1 hour",
    data: "the window: 1 minute (API), 15 minutes (auth, guest sessions), 1 hour (sign-ups)",
    page: /counts recent requests and connections per IP address, for 1 minute to 1 hour/,
  },
  {
    fact: "backups are kept 30 days",
    data: "| [Backups](#backups) | yes: everything in MongoDB | 30 days |",
    page: /Every night GitHub Actions makes an encrypted copy of the whole database.*Each copy is deleted after 30 days/,
  },
  {
    fact: "sessions roll for 30 days",
    data: "30 days after the last visit (`SESSION_TTL_SECONDS`, rolling)",
    page: /Sessions end 30 days after your last visit/,
  },
  {
    fact: "a signed-in session also ends 90 days after signing in",
    data: "An account's session also stops working 90 days after signing in",
    page: /A signed-in session also ends 90 days after you sign in, and when the password is changed or "sign out other devices" is used on another device/,
  },
  {
    fact: "logs hold player ids and room codes but no addresses or emails from the app",
    data: "**No IP addresses or emails** are written by the app.",
    page: /with the player id, room code or match id involved\. Our own log lines never hold your IP address, email or password/,
  },
  {
    fact: "Render keeps logs 7 to 14 days",
    data: "Render's plan: 7 days on Hobby, 14 on Pro",
    page: /Render keeps them for 7 to 14 days, depending on the plan/,
  },
  {
    fact: "there is no analytics yet, and it would be anonymous counts on our own server",
    data: "There is no telemetry yet",
    page: /We do not count how you use the site\. If we ever do, it will be anonymous counts on our own server/,
  },
  {
    fact: "blocks are kept until unblocked or an account is deleted",
    data: "Kept until the blocker unblocks, or either account is deleted",
    page: /we store that you blocked them, the name they had and when, until you unblock them or either account is deleted/,
  },
];

/** Sentences the page used to say that DATA.md shows are wrong (CC-241 F1 to F4, F8, F9). */
const NO_LONGER_TRUE = [
  /live only in the server.s memory/,
  /We do not record your IP address/,
  /for a few minutes/,
  /Two services run the site/,
  /never written to the database/,
];

describe("the privacy page says what docs/DATA.md says (CC-248)", () => {
  it.each(FACTS)("DATA.md still says it: $fact", ({ data }) => {
    expect(DATA_MD).toContain(data);
  });

  it.each(FACTS)("the page says it: $fact", ({ page }) => {
    renderApp({ path: "/privacy" });

    expect(flat(screen.getByRole("article").textContent)).toMatch(page);
  });

  it.each(NO_LONGER_TRUE)("no longer says %s", (wrong) => {
    renderApp({ path: "/privacy" });

    expect(flat(screen.getByRole("article").textContent)).not.toMatch(wrong);
  });

  it("names no analytics service and says nothing is counted today", () => {
    renderApp({ path: "/privacy" });
    const text = flat(screen.getByRole("article").textContent);

    expect(text).toMatch(/no third party analytics/);
    expect(text).not.toMatch(/Google Analytics|Plausible|PostHog|Mixpanel/);
  });
});
