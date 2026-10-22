import { Link } from "react-router";
import styles from "./Tabs.module.css";

/**
 * The app's one set of tabs (CC-323): a row of links, each its own page with its own URL, the shown one marked
 * with `aria-current="page"`. It is navigation, not an ARIA tab list, because each tab loads a page, and the Back
 * button and a shared link keep working. The tabs scroll sideways on a narrow screen instead of wrapping.
 *
 * @param {{
 *   label: string,
 *   items: ReadonlyArray<{ id: string, label: import("react").ReactNode, to: string, icon?: import("react").ReactNode }>,
 *   current: string,
 *   control: string,
 *   className?: string,
 * }} props  `label`: the navigation's name, such as "Leaderboards". `current`: the id of the shown tab.
 *   `control`: the prefix of each tab's control name, which ends with the tab's id
 */
export function Tabs({ label, items, current, control, className = "" }) {
  return (
    <nav aria-label={label} className={`${styles.tabs} ${className}`}>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={item.to}
              className={styles.tab}
              aria-current={item.id === current ? "page" : undefined}
              data-cc-control={`${control}.${item.id}`}
            >
              {item.icon !== undefined && (
                <span className={styles.icon} aria-hidden="true">
                  {item.icon}
                </span>
              )}
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
