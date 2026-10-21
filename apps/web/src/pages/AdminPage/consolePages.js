import { ADMIN_SECTIONS, paths, ROUTES } from "../../app/paths.js";

/**
 * The owner console's pages, written once (CC-233, CC-290, CC-044). The tab bar, the page titles, the lazily loaded parts and
 * the app's routes all read this list, so a new console page is one entry here and its component.
 */

/**
 * The parts of the console: the totals with their range, the feedback inbox, the reports (CC-044), the year of
 * birth corrections (CC-152), the flags (CC-312) and the living design contract (CC-314). Each loads on its own.
 */
export const CONSOLE_VIEWS = Object.freeze({
  TOTALS: "totals",
  FEEDBACK: "feedback",
  REPORTS: "reports",
  AGES: "ages",
  FLAGS: "flags",
  DESIGN: "design",
});

const titleOf = (word) => word[0].toUpperCase() + word.slice(1);

/**
 * @typedef {{ id: string, name: string, view: string, section?: string }} ConsolePage   `section` is the totals'
 *   section in the address, none for the overview
 */

/**
 * Every page in tab order: the overview, each section of the totals, the feedback inbox, the reports, the ages, the
 * flags, then the design contract.
 */
export const CONSOLE_PAGES = Object.freeze([
  Object.freeze({ id: "overview", name: "Overview", view: CONSOLE_VIEWS.TOTALS }),
  ...ADMIN_SECTIONS.map((section) =>
    Object.freeze({ id: section, name: titleOf(section), view: CONSOLE_VIEWS.TOTALS, section }),
  ),
  Object.freeze({ id: "feedback", name: "Feedback", view: CONSOLE_VIEWS.FEEDBACK }),
  Object.freeze({ id: "reports", name: "Reports", view: CONSOLE_VIEWS.REPORTS }),
  Object.freeze({ id: "ages", name: "Ages", view: CONSOLE_VIEWS.AGES }),
  Object.freeze({ id: "flags", name: "Flags", view: CONSOLE_VIEWS.FLAGS }),
  Object.freeze({ id: "design", name: "Design", view: CONSOLE_VIEWS.DESIGN }),
]);

/** The routes of the console and the part each one loads. */
export const CONSOLE_ROUTES = Object.freeze([
  Object.freeze({ path: ROUTES.ADMIN, view: CONSOLE_VIEWS.TOTALS }),
  Object.freeze({ path: ROUTES.ADMIN_SECTION, view: CONSOLE_VIEWS.TOTALS }),
  Object.freeze({ path: ROUTES.ADMIN_FEEDBACK, view: CONSOLE_VIEWS.FEEDBACK }),
  Object.freeze({ path: ROUTES.ADMIN_REPORTS, view: CONSOLE_VIEWS.REPORTS }),
  Object.freeze({ path: ROUTES.ADMIN_AGES, view: CONSOLE_VIEWS.AGES }),
  Object.freeze({ path: ROUTES.ADMIN_FLAGS, view: CONSOLE_VIEWS.FLAGS }),
  Object.freeze({ path: ROUTES.ADMIN_DESIGN, view: CONSOLE_VIEWS.DESIGN }),
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
  [CONSOLE_VIEWS.REPORTS]: () => paths.adminReports(),
  [CONSOLE_VIEWS.AGES]: () => paths.adminAges(),
  [CONSOLE_VIEWS.FLAGS]: () => paths.adminFlags(),
  [CONSOLE_VIEWS.DESIGN]: () => paths.adminDesign(),
});

export const consoleHref = (page, range) =>
  page.view === CONSOLE_VIEWS.TOTALS ? paths.admin(page.section, range) : HREFS[page.view]();
