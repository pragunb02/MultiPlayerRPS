/**
 * Fixed answers of `GET /api/admin/ux` for the UX page's tests (CC-177, CC-313), in the shapes the server's
 * `domain/telemetry/uxReport.js` sends: totals only, with `"<5"` where a group is 1 to 4.
 */
const RANGE = Object.freeze({ from: "2026-10-14", to: "2026-10-20" });
const BEFORE = Object.freeze({ from: "2026-10-07", to: "2026-10-13" });
const base = (section, range = RANGE, before = BEFORE) => ({ section, range, before, generatedAt: 0 });
const c = (now, before, change = null) => ({ now, before, change });

export const UX_FUNNELS = Object.freeze({
  ...base("funnels"),
  funnels: [
    {
      id: "visit_to_play",
      steps: [
        { id: "landed", ...c(1351, 1080, 0.2509) },
        { id: "first_move", ...c(959, 770, 0.2455), ratio: 0.7098, capped: false },
      ],
    },
    {
      id: "link_to_seat",
      steps: [
        { id: "room_link_landed", ...c(280, 224) },
        { id: "join_guest", ...c(310, 180), ratio: 1, capped: true },
        { id: "guest_started", ...c(196, 157), ratio: 0.6323, capped: false },
      ],
    },
    {
      id: "sign_up",
      steps: [
        { id: "form_viewed", ...c(350, 280) },
        { id: "form_submitted", ...c(140, 112), ratio: 0.4, capped: false },
        { id: "account_created", ...c(84, 67), ratio: 0.6, capped: false },
      ],
    },
  ],
  byEntry: [
    { entry: "direct", landings: 840, firstMoves: 560, ratio: 0.6667, capped: false },
    { entry: "search", landings: "<5", firstMoves: "<5", ratio: "<5", capped: false },
  ],
  rejected: [
    { field: "password", rule: "too_short", count: 63 },
    { field: "email", rule: "format", count: "<5" },
  ],
  registered: [
    {
      id: "challenge",
      steps: [
        { id: "challenge_opened", ticket: "CC-139", ...c(42, 0, "new"), isNew: true },
        {
          id: "challenge_accepted",
          ticket: "CC-139",
          ...c(21, 0, "new"),
          isNew: true,
          ratio: 0.5,
          capped: false,
        },
      ],
    },
  ],
});

const hotspot = (route, target, by, count, share) => ({ route, target, by, count, share });
const deadHotspots = [
  hotspot("/", "img", "element", 98, 0.07),
  hotspot("/games/rock-paper-scissors", "lobby.rules", "control", 49, 0.1167),
  ...Array.from({ length: 9 }, (_, index) =>
    hotspot("/profile", `profile.part${index}`, "control", 20 - index, 0.01),
  ),
  hotspot("/leaderboards", "div", "element", "<5", "<5"),
].slice(0, 10);

export const UX_CLICKS = Object.freeze({
  ...base("clicks"),
  presses: c(2044, 1635, 0.2502),
  dead: c(161, 129, 0.248),
  rage: c(42, 34, 0.2353),
  per100Presses: { now: 9.9315, before: 9.9 },
  deadHotspots,
  rageHotspots: [
    hotspot("/games/rock-paper-scissors/rooms/:code", "room.rematch.ask", "control", 42, 0.1875),
  ],
});

const speedRow = (fields, pages, p75) => ({
  ...fields,
  pages,
  p75,
  good: Object.fromEntries(
    Object.entries(p75).map(([field, value]) => [
      field,
      typeof value === "number"
        ? value <= { lcp_ms: 2500, inp_ms: 200, cls: 0.1, fcp_ms: 1800, ttfb_ms: 800 }[field]
        : null,
    ]),
  ),
});
const P75 = { lcp_ms: 3000, inp_ms: 250, cls: 0.05, fcp_ms: 1800, ttfb_ms: 800 };

export const UX_SPEED = Object.freeze({
  ...base("speed"),
  lines: {
    lcp_ms: { cwv: 2500, growth: 2500, line: 2500 },
    inp_ms: { cwv: 200, growth: 200, line: 200 },
    cls: { cwv: 0.1, growth: 0.1, line: 0.1 },
    fcp_ms: { cwv: 1800, line: 1800 },
    ttfb_ms: { cwv: 800, line: 800 },
  },
  overall: { now: speedRow({}, 651, P75), before: speedRow({}, 520, P75) },
  byDevice: [speedRow({ device: "phone" }, 420, P75)],
  byRouteDevice: [
    speedRow({ route: "/", device: "phone" }, 420, P75),
    speedRow({ route: "/", device: "desktop" }, 210, {
      lcp_ms: 1500,
      inp_ms: 100,
      cls: 0.01,
      fcp_ms: null,
      ttfb_ms: 500,
    }),
    speedRow({ route: "/leaderboards", device: "phone" }, "<5", {
      lcp_ms: "<5",
      inp_ms: null,
      cls: null,
      fcp_ms: null,
      ttfb_ms: null,
    }),
  ],
  byBuild: [
    speedRow({ build: "2026.10.20+def5678" }, 325, P75),
    speedRow({ build: "2026.10.18+abc1234" }, 326, P75),
  ],
  firstMove: {
    target: 10_000,
    now: 12_500,
    before: 12_500,
    byEntry: [
      { entry: "direct", games: 560, p75: 12_500 },
      { entry: "search", games: "<5", p75: "<5" },
    ],
  },
});

const event = (name, now, before) => ({
  event: name,
  ...c(now, before),
  byDay: [{ day: "2026-10-20", count: now === 0 ? 0 : 6 }],
  byBuild: [
    { build: "2026.10.20+def5678", count: 21, per100Pages: 1.2 },
    { build: "2026.10.18+abc1234", count: "<5", per100Pages: "<5" },
  ],
});
export const UX_ERRORS = Object.freeze({
  ...base("errors"),
  builds: ["2026.10.20+def5678", "2026.10.18+abc1234"],
  events: [
    event("client_errored", 63, 50),
    event("request_failed", 91, 73),
    event("socket_changed", 84, 67),
    event("server_errored", 28, 22),
  ],
  clientErrors: [{ kind: "render", error_type: "TypeError", count: 42 }],
  failedRequests: [{ endpoint: "/api/matches", code: "network", count: 56 }],
  serverErrors: [{ operation: "/api/matches", code: "INTERNAL", count: 28 }],
});

export const UX_LATENCY = Object.freeze({
  ...base("latency"),
  controls: [
    { control: "lobby.create", presses: 280, p50: 500, p95: 900 },
    { control: "room.leave", presses: "<5", p50: "<5", p95: "<5" },
  ],
  outcomes: [{ outcome: "ok", count: 280 }],
});

const budget = {
  minShown: 50,
  lines: [
    { measure: "optional_per_visit", value: 0.93, before: 0.9, colour: "amber" },
    { measure: "visits_with_three_or_more", value: 0.0667, before: 0.06, colour: "amber" },
    { measure: "optional_per_game_during_play", value: 0, before: 0, colour: "green" },
    { measure: "blocking_optional_during_play", value: 0, before: 0, colour: "green" },
    { measure: "first_move_p75_slower", value: null, before: null, colour: "none" },
    { measure: "rage_and_dead_per_100_presses", value: 9.93, before: 9.9, colour: "red" },
  ],
  surfaces: [
    {
      surface: "toast.xp",
      shown: 630,
      dismissed: { value: 0.3333, colour: "green" },
      covered: { value: 0, colour: "green" },
    },
    {
      surface: "toast.quest",
      shown: 28,
      dismissed: { value: 0, colour: "none" },
      covered: { value: 1, colour: "none" },
    },
  ],
  worst: "red",
};
export const UX_INTERRUPTIONS = Object.freeze({ ...base("interruptions"), ...budget });

export const UX_WEEK = Object.freeze({
  ...base("week", { from: "2026-10-12", to: "2026-10-18" }, { from: "2026-10-05", to: "2026-10-11" }),
  budget,
  badge: "red",
  surfaces: [
    {
      surface: "toast.xp",
      ticket: "CC-017",
      shown: 630,
      outcomes: { timed_out: 0.6667, dismissed: 0.3333 },
      medianShown: "3-10s",
      phases: { result: 1 },
    },
    {
      surface: "toast.quest",
      ticket: "CC-089",
      shown: 28,
      outcomes: { covered: 1 },
      medianShown: "0-1s",
      phases: { result: 1 },
    },
  ],
  perVisitAndGame: [
    { scope: "visit", device: "phone", optional: "0", count: 560 },
    { scope: "game", device: "phone", optional: "1", count: "<5" },
  ],
  text: {
    budgets: { home: 80, result: 60 },
    overBudgetToday: { result: { fold: 80, words: 120 } },
    lastMeasured: {
      on: "2026-10-21",
      fold: { home: { phone: 25, laptop: 25 }, result: { phone: 69, laptop: 74 } },
    },
    runtime: [{ route: "/", measure: "words", bucket: "51-100", count: 700 }],
  },
  firstMove: {
    byEntry: [{ entry: "direct", games: 560, p75: 12_500 }],
    byInterruptionsBefore: [
      { interruptionsBefore: "0", games: 480, p75: 11_000 },
      { interruptionsBefore: "2", games: "<5", p75: "<5" },
    ],
  },
  hotspots: {
    dead: deadHotspots.slice(0, 2),
    rage: UX_CLICKS.rageHotspots,
    bySurface: [{ kind: "rage", surface: "toast.xp", count: 42 }],
  },
  funnels: UX_FUNNELS.registered,
  flagGuardrails: [],
});

/** The fixed answer of each section. */
export const UX_REPORTS = Object.freeze({
  funnels: UX_FUNNELS,
  clicks: UX_CLICKS,
  errors: UX_ERRORS,
  speed: UX_SPEED,
  latency: UX_LATENCY,
  interruptions: UX_INTERRUPTIONS,
  week: UX_WEEK,
  badge: { section: "badge", range: UX_WEEK.range, badge: "red", generatedAt: 0 },
});
