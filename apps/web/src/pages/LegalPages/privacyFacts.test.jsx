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
    fact: "the HTTP rate limits keep addresses for 1 minute to 1 day",
    data: "the window: 1 minute (API), 15 minutes (auth, guest sessions), 1 hour (sign-ups)",
    page: /counts recent requests and connections per IP address, for 1 minute to 1 day/,
  },
  {
    fact: "the chess rating keeps its last 200 changes and the room sees it",
    data: "| [`chess_ratings`](#chess_ratings) | pseudonymous: chess rating and its last 200 changes |",
    page: /Your chess rating and its last 200 changes.*Your opponent and anyone watching the room see your rating/,
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
    fact: "usage counts are anonymous, on our own server, kept per hour never as single events, 30 days, off with the switch, GPC or DNT (CC-174)",
    data: "| [`telemetry_counts`](#telemetry_counts) | no: anonymous hourly counters, one per tuple of catalogue fields and India hour | 30 days after the hour |",
    page: /These counts go only to our own server and our own database\. They never include your name, email, IP address, what you type, or the code of your room\. The time is kept to the hour only\..*the counts carry no id at all.*never a single press or page on its own, so nothing says which counts came from one visit or in which order\. These hourly counts are deleted after 30 days\..*If your browser sends Global Privacy Control or Do Not Track, it is off already/,
  },
  {
    fact: "the usage counts switch keeps only cc.telemetry in this browser (CC-174)",
    data: "| [`cc.telemetry`](#cctelemetry-in-localstorage) | no: only `off`, when the player switched usage counts off |",
    page: /cc\.telemetry, only if you switch usage counts off/,
  },
  {
    fact: "profiles start private, only adults can be public, everyone else is Hidden player (CC-034)",
    data: "once chosen: left out means private",
    page: /It starts private: others see only your name and avatar\. If you are 18 or over you can make it public.*the profile shows "Hidden player" with the avatar they picked, and nothing else/,
  },
  {
    fact: "feedback is kept 180 days, without a player id or an address",
    data: "| [`feedback`](#feedback) | the message as typed, and a reply email from an adult who gave one | 180 days after it was sent |",
    page: /We never store your player id, your IP address or your browser details with it\..*Feedback is deleted 180 days after it was sent/,
  },
  {
    fact: "friendships are kept until either removes, blocks or deletes the account (CC-052)",
    data: "| [`friendships`](#friendships) | pseudonymous: both player ids, since when | until either removes the other, blocks the other or deletes the account |",
    page: /We store who is friends with whom and when, until either of you removes the other, blocks the other or deletes the account/,
  },
  {
    fact: "a friend request lasts 30 days and a friend link works once for 7 days, stored as a hash (CC-052)",
    data: "| [`friend_links`](#friend_links) | pseudonymous: who made it, a SHA-256 of its token | 7 days, or until it is used |",
    page: /A friend request is kept for 30 days, and a friend link works once, for 7 days: we store only a scrambled copy of the link/,
  },
  {
    fact: "presence is never stored and Appear offline is kept until changed (CC-052)",
    data: "| [`player_privacy`](#player_privacy) | pseudonymous: player id, the Appear offline choice | until the player changes it or deletes the account |",
    page: /We work it out while you are connected and never store it\. You can turn on Appear offline/,
  },
  {
    fact: "blocks are kept until unblocked or an account is deleted",
    data: "Kept until the blocker unblocks, or either account is deleted",
    page: /we store that you blocked them, the name they had and when, until you unblock them or either account is deleted/,
  },
  {
    fact: "reports are kept 180 days, and the reported player is never told (CC-044, ADR-071)",
    data: "| [`player_reports`](#player_reports) | pseudonymous: both player ids, the reported name then, the reason, where, the last moves, no free text |",
    page: /we store who you reported.*The reported player is never told.*Reports are deleted 180 days after they were made/,
  },
  {
    fact: "your own reports are in your export, without the other player's id (CC-044)",
    data: "the reports the player made: reason, where, the name, when",
    page: /and the reports you made\. Other players appear in it by their display name only/,
  },
  {
    fact: "operations telemetry goes to Grafana Labs with no personal data (ADR-055)",
    data: "| [Operations telemetry](#operations-telemetry) | no: counts, timings and the names of warnings, never an id, name, email, IP address, room code, cookie or session |",
    page: /Grafana Labs.*receives counts and timings about how the server runs, and the names of its warnings and errors\. Never your IP address, email, player id, name, room code, cookies or session/,
  },
  {
    fact: "a new password's check sends Have I Been Pwned only the first 5 characters of its SHA-1, from the server (CC-261)",
    data: "| [Breached password check](#breached-password-check) | no: the first 5 hex characters of a new password's SHA-1, sent by the server, never the password, its full hash, an email, an id or the player's IP address |",
    page: /Have I Been Pwned.*When you choose a password.*our server sends it the first 5 characters of a scrambled form of the password.*never receives the password itself, the rest of the scrambled form, your email or anything else about you/,
  },
  {
    fact: "operations telemetry is kept 14 days",
    data: "14 days (Grafana Cloud free tier)",
    page: /Counts and timings about how the server runs are kept for 14 days by Grafana Labs/,
  },
];

/** Sentences the page used to say that DATA.md shows are wrong (CC-241 F1 to F4, F8, F9). */
const NO_LONGER_TRUE = [
  /live only in the server.s memory/,
  /We do not record your IP address/,
  /for a few minutes/,
  /Two services run the site/,
  /Three services run the site/,
  /Four services run the site/,
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

  it("names no analytics service, and says the counts are our own", () => {
    renderApp({ path: "/privacy" });
    const text = flat(screen.getByRole("article").textContent);

    expect(text).toMatch(/no third-party analytics/);
    expect(text).toMatch(/These counts go only to our own server/);
    expect(text).not.toMatch(/Google Analytics|Plausible|PostHog|Mixpanel/);
  });
});
