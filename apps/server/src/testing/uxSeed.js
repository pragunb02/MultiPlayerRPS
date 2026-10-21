import { startOfDay } from "../utils/indiaTime.js";

const HOUR_MS = 60 * 60 * 1000;
/** Two builds, so the console's "by build" view has something to compare. */
export const SEED_BUILDS = Object.freeze(["2026.10.18+abc1234", "2026.10.20+def5678"]);
const SERVER_BUILD = "2026.10.20+def5678";

/**
 * Made-up usage counts for one India day, as events with the hour they arrived in (CC-176, CC-177). Every value is
 * from the catalogue, and some groups are 1 to 4 on purpose, so the console's `"<5"` shows. Nothing here is about a
 * real person: there are no people in it at all, only totals.
 *
 * @param {{ day: string, scale?: number }} input  `scale` multiplies every count, for the period before
 * @returns {Array<Record<string, unknown> & { receivedAt: number, name: string }>}
 */
export function uxSeedEvents({ day, scale = 1 }) {
  const start = startOfDay(day);
  const events = [];
  let seq = 0;
  /** `count` events, spread over the day's hours, the build taking turns. `fields` may be a function of the index. */
  const many = (count, name, fields, { server = false } = {}) => {
    const total = Math.max(0, Math.round(count * scale));
    for (let index = 0; index < total; index += 1) {
      seq += 1;
      const own = typeof fields === "function" ? fields(index) : fields;
      events.push({
        receivedAt: start + (seq % 24) * HOUR_MS,
        name,
        tier: "counts",
        build: server ? SERVER_BUILD : SEED_BUILDS[index % SEED_BUILDS.length],
        ...(server ? { player_kind: "guest" } : { route: "/", device: "phone", player_kind: "guest" }),
        ...own,
      });
    }
  };
  const spread = (index, low, high) =>
    Math.round((low + ((index * 37) % 100) * ((high - low) / 100)) / 10) * 10;

  // Landings by entry, and the first moves they led to.
  many(120, "page_viewed", { is_landing: true, entry: "direct" });
  many(40, "page_viewed", {
    is_landing: true,
    entry: "room_link",
    route: "/games/rock-paper-scissors/rooms/:code",
  });
  many(30, "page_viewed", { is_landing: true, entry: "shared_link", via: "wa" });
  many(3, "page_viewed", { is_landing: true, entry: "search" });
  many(220, "page_viewed", { is_landing: false, route: "/games/rock-paper-scissors" });
  const firstMove = (entry) => (index) => ({
    game_id: "rps",
    entry,
    since_load_ms: spread(index, 3000, 16_000),
    interruptions_before: ["0", "0", "1", "2"][index % 4],
    route: "/games/rock-paper-scissors/rooms/:code",
  });
  many(80, "gameplay_started", firstMove("direct"));
  many(30, "gameplay_started", firstMove("room_link"));
  many(25, "gameplay_started", firstMove("shared_link"));
  many(2, "gameplay_started", firstMove("search"));
  // Presses, a link's guest seat and the new guests.
  many(200, "control_pressed", { control: "home.play_guest", has_reason: false });
  many(60, "control_pressed", {
    control: "lobby.create",
    has_reason: false,
    route: "/games/rock-paper-scissors",
  });
  many(32, "control_pressed", {
    control: "join.guest",
    has_reason: false,
    route: "/games/rock-paper-scissors/rooms/:code",
  });
  many(28, "guest_started", {}, { server: true });
  // Dead and rage clicks: a picture people tap on the home page, a rules line, and a small one that stays hidden.
  many(14, "dead_clicked", { element: "img" });
  many(7, "dead_clicked", { control: "lobby.rules", route: "/games/rock-paper-scissors" });
  many(2, "dead_clicked", { element: "div", route: "/leaderboards" });
  many(5, "dead_clicked", { control: "toast.xp.close", route: "/profile", surface: "toast.xp" });
  many(6, "rage_clicked", {
    control: "room.rematch.ask",
    presses: "3",
    route: "/games/rock-paper-scissors/rooms/:code",
    surface: "toast.xp",
  });
  // Sign-up.
  many(50, "auth_form_viewed", { form: "signup", next_kind: "none", route: "/signup" });
  many(20, "auth_form_submitted", { form: "signup", route: "/signup" });
  many(9, "auth_form_rejected", { form: "signup", field: "password", rule: "too_short", route: "/signup" });
  many(3, "auth_form_rejected", { form: "signup", field: "email", rule: "format", route: "/signup" });
  many(12, "account_created", { from_guest: true }, { server: true });
  // Page speed: a slow home page on phones, a quick one on laptops.
  many(60, "page_speed_measured", (index) => ({
    lcp_ms: spread(index, 1500, 3400),
    inp_ms: spread(index, 90, 260),
    cls: [0.01, 0.02, 0.05, 0.12][index % 4],
    ttfb_ms: spread(index, 250, 950),
    fcp_ms: spread(index, 900, 2200),
    was_waking: false,
  }));
  many(30, "page_speed_measured", (index) => ({
    device: "desktop",
    lcp_ms: spread(index, 700, 1600),
    inp_ms: spread(index, 40, 120),
    cls: 0.01,
    ttfb_ms: spread(index, 150, 500),
    was_waking: false,
  }));
  many(3, "page_speed_measured", { route: "/leaderboards", lcp_ms: 2100, was_waking: false });
  many(40, "action_waited", (index) => ({
    control: "lobby.create",
    transport: "socket",
    wait_ms: spread(index, 120, 900),
    outcome: "ok",
    showed_spinner: index % 5 === 0,
  }));
  many(150, "visit_ended", (index) => ({
    active_s: ["30-60", "60-120", "120-300"][index % 3],
    presses: "6-20",
  }));
  // Interruptions: the XP toast after games, the save progress card, the feedback dialog and the connection banner.
  const ended = (surface, kind, cls, opens, blocking, outcome, phase, count, shown = "1-3s") =>
    many(count, "interruption_ended", {
      surface,
      kind,
      class: cls,
      blocking,
      outcome,
      shown_ms: shown,
      phase,
      trigger: opens,
      stack: "0",
    });
  ended("toast.xp", "toast", "optional", "system", false, "timed_out", "result", 60, "3-10s");
  ended("toast.xp", "toast", "optional", "system", false, "dismissed", "result", 30);
  ended("card.save_progress", "card", "optional", "system", false, "acted", "result", 25, "10s+");
  ended("card.save_progress", "card", "optional", "system", false, "dismissed", "result", 20);
  ended("toast.quest", "toast", "optional", "system", false, "covered", "result", 4, "0-1s");
  ended("dialog.feedback", "dialog", "optional", "player", true, "acted", "elsewhere", 8, "10s+");
  ended("banner.connection", "banner", "essential", "system", false, "timed_out", "playing", 10);
  const counted = (scope, optional, count) =>
    many(count, "interruption_counted", {
      scope,
      ...(scope === "game" && { game_id: "rps" }),
      optional,
      blocking_optional: "0",
      essential: "0",
    });
  counted("visit", "0", 80);
  counted("visit", "1", 40);
  counted("visit", "2", 20);
  counted("visit", "3-5", 10);
  counted("game", "0", 70);
  counted("game", "1", 10);
  many(100, "screen_text_measured", { words: "51-100", fold_words: "0-50" });
  many(40, "screen_text_measured", {
    words: "101-200",
    fold_words: "51-100",
    route: "/games/rock-paper-scissors",
  });
  const step = (funnel, id, count) => many(count, "funnel_step_reached", { funnel, step: id });
  step("visit_to_play", "landed", 190);
  step("visit_to_play", "game_opened", 150);
  step("visit_to_play", "seated", 110);
  step("visit_to_play", "first_move", 100);
  step("link_to_seat", "link_opened", 40);
  step("link_to_seat", "seated", 30);
  step("sign_up", "form_viewed", 50);
  step("sign_up", "form_submitted", 20);
  step("sign_up", "account_created", 12);
  step("challenge", "challenge_opened", 6);
  step("challenge", "challenge_accepted", 3);
  // Errors and connection.
  many(6, "client_errored", { kind: "render", error_type: "TypeError" });
  many(3, "client_errored", { kind: "chunk_load", error_type: "Error" });
  many(8, "request_failed", { endpoint: "/api/matches", status: 0, code: "network" });
  many(5, "request_failed", { endpoint: "/api/session/guest", status: 429, code: "RATE_LIMITED" });
  many(12, "socket_changed", { state: "dropped", code: "transport_close" });
  many(4, "server_errored", { operation: "/api/matches", code: "INTERNAL" }, { server: true });
  return events;
}
