import { useId } from "react";
import styles from "./Page.module.css";

/**
 * The top of a page: its one `h1` in the page-title type role, and an optional line saying what the page is for
 * (CC-323). Every page title looks the same, so no page module styles its own `h1`.
 *
 * @param {{
 *   title: import("react").ReactNode,
 *   lede?: import("react").ReactNode,
 *   aside?: import("react").ReactNode,
 *   id?: string,
 *   className?: string,
 * }} props  `aside`: art or a badge beside the title. `id`: the heading's id, for the page's `aria-labelledby`
 */
export function PageHeader({ title, lede, aside, id, className = "" }) {
  return (
    <header className={`${styles.pageHeader} ${className}`}>
      <div className={styles.pageText}>
        <h1 id={id} className={styles.pageTitle}>
          {title}
        </h1>
        {lede !== undefined && <p className={styles.lede}>{lede}</p>}
      </div>
      {aside !== undefined && <div className={styles.pageAside}>{aside}</div>}
    </header>
  );
}

/**
 * A titled section of a page (CC-323, docs/design/CONTRACT.md "Sections"): a heading, one line saying what it
 * holds, then the content. Sections are separated by the same space and a thin divider on every page, so a dense
 * page (the profile, the leaderboards, the owner console) reads as clear parts instead of floating blocks.
 *
 * @param {{
 *   title: import("react").ReactNode,
 *   description?: import("react").ReactNode,
 *   headingLevel?: 2 | 3,
 *   actions?: import("react").ReactNode,
 *   id?: string,
 *   className?: string,
 *   children: import("react").ReactNode,
 * }} props  `actions`: a small button or link at the end of the title row. `id`: the heading's id
 */
export function Section({ title, description, headingLevel = 2, actions, id, className = "", children }) {
  const fallback = useId();
  const headingId = id ?? fallback;
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className={`${styles.section} ${className}`} aria-labelledby={headingId}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionText}>
          <Heading id={headingId} className={styles.sectionTitle}>
            {title}
          </Heading>
          {description !== undefined && <p className={styles.sectionDescription}>{description}</p>}
        </div>
        {actions !== undefined && <div className={styles.sectionActions}>{actions}</div>}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

/**
 * The sections of a page, one under the other, with the page's rhythm: the same gap and divider between each.
 *
 * @param {{ children: import("react").ReactNode, className?: string }} props
 */
export function Sections({ children, className = "" }) {
  return <div className={`${styles.sections} ${className}`}>{children}</div>;
}
