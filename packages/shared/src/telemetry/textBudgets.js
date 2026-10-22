/**
 * The text budget of the key screens (CC-313 section 3, owner 2026-10-20): visible words in `main` above the fold, by
 * screen, the same on a phone and a laptop. All of `main` may hold twice that. The browser suite
 * (`e2e/textBudget.spec.js`) fails a pull request over them, and the console's Week view shows them (CC-177).
 */
export const TEXT_BUDGETS = Object.freeze({
  home: 80,
  "game page": 120,
  "room waiting": 60,
  "room playing (outside the board)": 30,
  result: 60,
  "sign-up": 80,
});

/**
 * Screens measured over their budget when the test was added (2026-10-21), so the test fails only if they grow.
 * Each is a finding for the owner, who either trims the screen (a ticket) or changes its budget, with a reason, in
 * the pull request that does. Remove a line once its screen fits.
 */
export const OVER_BUDGET_TODAY = Object.freeze({
  // The result with its rewards and the save progress card: 69 to 74 words above the fold in Chromium, as the
  // rewards of the game vary, so a few words of room.
  result: Object.freeze({ fold: 80, words: 120 }),
});

/**
 * The words above the fold the suite last measured on main, phone and laptop (CC-313 build notes, 2026-10-21). Each
 * pull request's own numbers are in its CI job summary. This line moves when a pull request changes a screen.
 */
export const TEXT_LAST_MEASURED = Object.freeze({
  on: "2026-10-21",
  fold: Object.freeze({
    home: Object.freeze({ phone: 25, laptop: 25 }),
    "game page": Object.freeze({ phone: 61, laptop: 72 }),
    "room waiting": Object.freeze({ phone: 27, laptop: 27 }),
    "room playing (outside the board)": Object.freeze({ phone: 14, laptop: 14 }),
    result: Object.freeze({ phone: 69, laptop: 74 }),
    "sign-up": Object.freeze({ phone: 39, laptop: 39 }),
  }),
});
