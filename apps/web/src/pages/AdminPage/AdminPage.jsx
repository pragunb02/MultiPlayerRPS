import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { SITE_NAME } from "@classicade/shared";
import { ADMIN_SECTIONS, paths } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { useAnalytics } from "../../hooks/useAnalytics.js";
import { isNotFound } from "../../lib/errors.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import { addDays, indiaToday } from "./format.js";
import { Conversion, Engagement, Games, Overview, Players, Retention } from "./sections.jsx";
import styles from "./AdminPage.module.css";

/** The tabs, in order: the overview first, then each section. */
const TABS = Object.freeze([
  { section: undefined, name: "Overview", Page: Overview },
  ...ADMIN_SECTIONS.map((section) => ({
    section,
    name: section[0].toUpperCase() + section.slice(1),
    Page: {
      players: Players,
      games: Games,
      retention: Retention,
      conversion: Conversion,
      engagement: Engagement,
    }[section],
  })),
]);
const PRESETS = Object.freeze([7, 30, 90, 365]);
const BUCKETS = Object.freeze([
  ["day", "Days"],
  ["week", "Weeks"],
  ["month", "Months"],
]);

/** The range in the address, as given. Empty fields mean the server's default range. */
function rangeFrom(search) {
  const pick = (key) => search.get(key) ?? undefined;
  return { from: pick("from"), to: pick("to"), bucket: pick("bucket") };
}

/**
 * The form that picks a range: from, to and how to group, plus links for the last 7, 30, 90 and 365 days. Each
 * choice is a new address, so Back and Forward walk through the ranges looked at.
 *
 * @param {{ section: string | undefined, shown: { from: string, to: string, bucket: string }, today: string }} props
 *   `today`: the India day the report was worked out on, so the links match its numbers
 */
function RangePicker({ section, shown, today }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(shown);

  const change = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });
  const submit = (event) => {
    event.preventDefault();
    navigate(paths.admin(section, draft));
  };
  return (
    <form className={styles.range} onSubmit={submit} aria-label="Date range">
      <label className={styles.rangeField}>
        From
        <input
          type="date"
          value={draft.from}
          max={draft.to}
          required
          onChange={change("from")}
          data-cc-control="admin.range.from"
        />
      </label>
      <label className={styles.rangeField}>
        To
        <input
          type="date"
          value={draft.to}
          min={draft.from}
          required
          onChange={change("to")}
          data-cc-control="admin.range.to"
        />
      </label>
      <label className={styles.rangeField}>
        Group by
        <select value={draft.bucket} onChange={change("bucket")} data-cc-control="admin.range.bucket">
          {BUCKETS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Button control="admin.range.show" type="submit" variant="primary">
        Show
      </Button>
      <p className={styles.presets}>
        Last{" "}
        {PRESETS.map((days, index) => (
          <span key={days}>
            {index > 0 && " · "}
            <Link
              to={paths.admin(section, {
                from: addDays(today, 1 - days),
                to: today,
                bucket: days > 90 ? "week" : "day",
              })}
              data-cc-control={`admin.range.last${days}`}
            >
              {days} days
            </Link>
          </span>
        ))}
      </p>
    </form>
  );
}

/**
 * The owner console (CC-233): how ClassiCade is played, in totals, from data the site already stores. Only an
 * admin reaches this page (AdminRoute). The section and the range live in the address, so a view can be
 * bookmarked and Back returns to the view before.
 */
export function AdminPage() {
  const { section } = useParams();
  const [search] = useSearchParams();
  const asked = rangeFrom(search);
  const analytics = useAnalytics(asked);
  const tab = TABS.find((candidate) => candidate.section === section);

  if (tab === undefined || (analytics.status === "error" && isNotFound(analytics.error))) {
    return <NotFoundPage />;
  }
  const { report } = analytics;
  const query = { from: asked.from, to: asked.to, bucket: asked.bucket };
  return (
    <section className={styles.page} aria-labelledby="admin-title">
      <title>{`${tab.name} · Owner console · ${SITE_NAME}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <header className={styles.header}>
        <h1 id="admin-title">Owner console</h1>
        <p className={styles.lede}>
          Totals from the matches, sign ups and rewards the site already stores. No names, no ids, and groups
          smaller than 5 are shown as “fewer than 5”. Days are India time.
        </p>
      </header>
      <nav aria-label="Console sections">
        <ul className={styles.tabs}>
          {TABS.map((candidate) => (
            <li key={candidate.name}>
              <Link
                to={paths.admin(candidate.section, query)}
                className={styles.tab}
                aria-current={candidate === tab ? "page" : undefined}
                data-cc-control={`admin.tab.${candidate.section ?? "overview"}`}
              >
                {candidate.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {analytics.status === "loading" && (
        <p className={styles.status} role="status">
          Counting…
        </p>
      )}
      {analytics.status === "error" && (
        <div className={styles.status} role="alert">
          <p>{analytics.error.message}</p>
          <Button control="admin.retry" variant="secondary" onClick={analytics.retry}>
            Try again
          </Button>
        </div>
      )}
      {report !== undefined && (
        <>
          <RangePicker
            key={`${report.range.from}|${report.range.to}|${report.range.bucket}`}
            section={section}
            today={indiaToday(report.generatedAt)}
            shown={report.range}
          />
          <p className={styles.generated}>
            {report.range.from} to {report.range.to}, India time. Worked out at{" "}
            {new Date(report.generatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })},
            refreshed every 5 minutes.
          </p>
          <div className={styles.body}>
            <tab.Page report={report} />
          </div>
        </>
      )}
    </section>
  );
}
