import { ADMIN_SECTIONS, paths, ROUTES } from "../../app/paths.js";

/**
 * The owner console's pages, written once (CC-233, CC-290). The tab bar, the page titles, the lazily loaded parts and
 * the app's routes all read this list, so a new console page is one entry here and its component.
 */

/**
 * The parts of the console: the totals with their range, the feedback inbox, the year of birth corrections
 * (CC-152) and the flags (CC-312). Each loads on its own.
 */
export const CONSOLE_VIEWS = Object.freeze({
  TOTALS: "totals",
  FEEDBACK: "feedback",
  AGES: "ages",
  FLAGS: "flags",
});

const titleOf = (word) => word[0].toUpperCase() + word.slice(1);

/**
 * @typedef {{ id: string, name: string, view: string, section?: string }} ConsolePage   `section` is the totals'
 *   section in the address, none for the overview
 */

/** Every page in tab order: the overview, each section of the totals, the feedback inbox, the ages, then the flags. */
export const CONSOLE_PAGES = Object.freeze([
  Object.freeze({ id: "overview", name: "Overview", view: CONSOLE_VIEWS.TOTALS }),
  ...ADMIN_SECTIONS.map((section) =>
    Object.freeze({ id: section, name: titleOf(section), view: CONSOLE_VIEWS.TOTALS, section }),
  ),
  Object.freeze({ id: "feedback", name: "Feedback", view: CONSOLE_VIEWS.FEEDBACK }),
  Object.freeze({ id: "ages", name: "Ages", view: CONSOLE_VIEWS.AGES }),
  Object.freeze({ id: "flags", name: "Flags", view: CONSOLE_VIEWS.FLAGS }),
]);

/** The routes of the console and the part each one loads. */
export const CONSOLE_ROUTES = Object.freeze([
  Object.freeze({ path: ROUTES.ADMIN, view: CONSOLE_VIEWS.TOTALS }),
  Object.freeze({ path: ROUTES.ADMIN_SECTION, view: CONSOLE_VIEWS.TOTALS }),
  Object.freeze({ path: ROUTES.ADMIN_FEEDBACK, view: CONSOLE_VIEWS.FEEDBACK }),
  Object.freeze({ path: ROUTES.ADMIN_AGES, view: CONSOLE_VIEWS.AGES }),
  Object.freeze({ path: ROUTES.ADMIN_FLAGS, view: CONSOLE_VIEWS.FLAGS }),
]);

/**
 * The address of a console page. A page of the totals keeps the range shown, so moving between them compares the
 * same days.
 *
 * @param {ConsolePage} page
 * @param {{ from?: string, to?: string, bucket?: string }} range
 */
const HREFS = Object.freeze({
  [CONSOLE_VIEWS.FEEDBACK]: () => paths.adminFeedback(),
  [CONSOLE_VIEWS.AGES]: () => paths.adminAges(),
  [CONSOLE_VIEWS.FLAGS]: () => paths.adminFlags(),
});

export const consoleHref = (page, range) =>
  page.view === CONSOLE_VIEWS.TOTALS ? paths.admin(page.section, range) : HREFS[page.view]();
