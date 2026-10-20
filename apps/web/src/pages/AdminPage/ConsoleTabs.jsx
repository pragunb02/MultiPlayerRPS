import { Link } from "react-router";
import { CONSOLE_PAGES, consoleHref } from "./consolePages.js";
import styles from "./AdminPage.module.css";

/**
 * The owner console's tab bar, the same on every console page (CC-290).
 *
 * @param {{ current: string, range?: { from?: string, to?: string, bucket?: string } }} props  `current` is the
 *   shown page's id in CONSOLE_PAGES, and `range` the totals' range to keep in their links
 */
export function ConsoleTabs({ current, range = {} }) {
  return (
    <nav aria-label="Console sections">
      <ul className={styles.tabs}>
        {CONSOLE_PAGES.map((page) => (
          <li key={page.id}>
            <Link
              to={consoleHref(page, range)}
              className={styles.tab}
              aria-current={page.id === current ? "page" : undefined}
              data-cc-control={`admin.tab.${page.id}`}
            >
              {page.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
