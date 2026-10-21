import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ANALYTICS_MAX_RANGE_DAYS, SITE_NAME } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { useAnalytics } from "../../hooks/useAnalytics.js";
import { useNow } from "../../hooks/useNow.js";
import { isNotFound, isRetryable } from "../../lib/errors.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import { addDays, indiaToday } from "./format.js";
import { Conversion, Engagement, Games, Overview, Players, Retention } from "./sections.jsx";
import { Statuses } from "./statuses.jsx";
import { ConsoleTabs } from "./ConsoleTabs.jsx";
import { CONSOLE_PAGES, CONSOLE_VIEWS } from "./consolePages.js";
import styles from "./AdminPage.module.css";

/** The page that draws each part of the totals, by its id in CONSOLE_PAGES. */
const SECTION_PAGES = Object.freeze({
  overview: Overview,
  statuses: Statuses,
  players: Players,
  games: Games,
  retention: Retention,
  conversion: Conversion,
  engagement: Engagement,
});
const TOTALS_PAGES = CONSOLE_PAGES.filter((page) => page.view === CONSOLE_VIEWS.TOTALS);
const PRESETS = Object.freeze([7, 30, 90, 365]);
/** The range the server reports on when the address has none: the 30 days that end today. */
const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOO_LONG = `A range can cover at most ${ANALYTICS_MAX_RANGE_DAYS} days.`;
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

/** The asked range with the server's defaults filled in, for a form shown when there is no report. */
const filledIn = (asked, today) => ({
  from: asked.from ?? addDays(today, 1 - DEFAULT_RANGE_DAYS),
  to: asked.to ?? today,
  bucket: asked.bucket ?? "day",
});

/** How many days a range covers, both ends included. */
const lengthOf = ({ from, to }) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

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
  const [tooLong, setTooLong] = useState(false);

  const change = (key) => (event) => {
    setTooLong(false);
    setDraft({ ...draft, [key]: event.target.value });
  };
  const submit = (event) => {
    event.preventDefault();
    // The server refuses longer ranges, so say so here rather than open a page that can only fail.
    if (lengthOf(draft) > ANALYTICS_MAX_RANGE_DAYS) {
      setTooLong(true);
      return;
    }
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
      {tooLong && (
        <p className={styles.rangeError} role="alert">
          {TOO_LONG}
        </p>
      )}
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
  const now = useNow(60_000);
  const tab = TOTALS_PAGES.find((candidate) => candidate.section === section);

  if (tab === undefined || (analytics.status === "error" && isNotFound(analytics.error))) {
    return <NotFoundPage />;
  }
  const Page = SECTION_PAGES[tab.id];
  const { report } = analytics;
  const query = { from: asked.from, to: asked.to, bucket: asked.bucket };
  // Without a report the form starts from the range that was asked for, so a refused range can be corrected.
  const today = indiaToday(report?.generatedAt ?? now);
  const shown = report?.range ?? filledIn(asked, today);
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
      <ConsoleTabs current={tab.id} range={query} />
      {analytics.status === "loading" && (
        <p className={styles.status} role="status">
          Counting…
        </p>
      )}
      {analytics.status === "error" && (
        <div className={styles.status} role="alert">
          <p>{analytics.error.message}</p>
          {isRetryable(analytics.error) && (
            <Button control="admin.retry" variant="secondary" onClick={analytics.retry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {analytics.status !== "loading" && (
        <RangePicker
          key={`${shown.from}|${shown.to}|${shown.bucket}`}
          section={section}
          today={today}
          shown={shown}
        />
      )}
      {report !== undefined && (
        <>
          <p className={styles.generated}>
            {report.range.from} to {report.range.to}, India time. Worked out at{" "}
            {new Date(report.generatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })},
            refreshed every 5 minutes.
          </p>
          {/* The section's own heading, so each chart's h3 sits under an h2 (axe heading-order, CC-324). */}
          <h2 className={styles.sectionTitle}>{tab.name}</h2>
          <div className={styles.body}>
            <Page report={report} />
          </div>
        </>
      )}
    </section>
  );
}
