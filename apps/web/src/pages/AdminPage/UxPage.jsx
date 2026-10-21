import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ANALYTICS_MAX_RANGE_DAYS, SITE_NAME } from "@classicade/shared";
import { paths, UX_SECTIONS } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { Button } from "../../components/Button/Button.jsx";
import { Card } from "../../components/Card/Card.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { PageHeader, Sections } from "../../components/Page/Page.jsx";
import { ErrorState, Skeleton } from "../../components/States/States.jsx";
import { Tabs } from "../../components/Tabs/Tabs.jsx";
import { FLAG_STATES, useFlagState } from "../../hooks/useFlag.js";
import { useNow } from "../../hooks/useNow.js";
import { useUxReport } from "../../hooks/useUxReport.js";
import { isNotFound, isRetryable } from "../../lib/errors.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import { ConsoleTabs } from "./ConsoleTabs.jsx";
import { addDays, indiaToday } from "./format.js";
import { Clicks, Errors, Funnels, Interruptions, Latency, Speed } from "./UxPanel.jsx";
import { UxWeek } from "./UxWeek.jsx";
import { UX_SECTION_LEDES, UX_SECTION_NAMES } from "./uxText.js";
import consoleStyles from "./AdminPage.module.css";
import styles from "./UxPage.module.css";

const PRESETS = Object.freeze([7, 28]);
const VIEWS = Object.freeze({
  funnels: Funnels,
  clicks: Clicks,
  errors: Errors,
  speed: Speed,
  latency: Latency,
  interruptions: Interruptions,
});
const DAY_MS = 24 * 60 * 60 * 1000;
const lengthOf = ({ from, to }) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
/** Monday in India (0 is Sunday). */
const isMonday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 1;

/**
 * The range form of a section: from and to, as whole India days ending yesterday at the latest, and links for the
 * last 7 and 28 full days. Each choice is a new address, so Back walks through the ranges looked at.
 */
function RangePicker({ section, shown, yesterday }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(shown);
  const [problem, setProblem] = useState("");
  const change = (key) => (event) => {
    setProblem("");
    setDraft({ ...draft, [key]: event.target.value });
  };
  const submit = (event) => {
    event.preventDefault();
    // The server refuses these too. Saying so here saves opening a page that can only fail.
    if (draft.to > yesterday) return setProblem("A range ends yesterday at the latest: today is not over.");
    if (draft.from > draft.to) return setProblem("The range must start before it ends.");
    if (lengthOf(draft) > ANALYTICS_MAX_RANGE_DAYS) {
      return setProblem(`A range can cover at most ${ANALYTICS_MAX_RANGE_DAYS} days.`);
    }
    return navigate(paths.adminUx(section, draft));
  };
  return (
    <Card as="form" className={consoleStyles.range} onSubmit={submit} noValidate aria-label="Date range">
      <div className={consoleStyles.rangeFields}>
        <Field
          label="From"
          kind="date"
          value={draft.from}
          max={draft.to}
          required
          onChange={change("from")}
          data-cc-control="admin.ux.range.from"
        />
        <Field
          label="To"
          kind="date"
          value={draft.to}
          min={draft.from}
          max={yesterday}
          required
          onChange={change("to")}
          data-cc-control="admin.ux.range.to"
        />
        <Button control="admin.ux.range.show" type="submit" variant="primary">
          Show
        </Button>
      </div>
      {problem !== "" && (
        <p className={consoleStyles.rangeError} role="alert">
          {problem}
        </p>
      )}
      <p className={consoleStyles.presets}>
        <span className={consoleStyles.presetsLabel}>Last full</span>
        {PRESETS.map((days) => (
          <Button
            key={days}
            as="link"
            size="sm"
            variant="ghost"
            to={paths.adminUx(section, { from: addDays(yesterday, 1 - days), to: yesterday })}
            control={`admin.ux.range.last${days}`}
            aria-label={`Last ${days} days`}
          >
            {days} days
          </Button>
        ))}
      </p>
    </Card>
  );
}

/** The week's own picker: the week before, and back to the last full week. */
function WeekPicker({ range, lastWeek }) {
  const earlier = { from: addDays(range.from, -7), to: addDays(range.to, -7) };
  const later = { from: addDays(range.from, 7), to: addDays(range.to, 7) };
  return (
    <p className={consoleStyles.presets}>
      <Button
        as="link"
        size="sm"
        variant="ghost"
        to={paths.adminUx("week", earlier)}
        control="admin.ux.week.earlier"
      >
        Week before
      </Button>
      {range.from < lastWeek.from && (
        <Button
          as="link"
          size="sm"
          variant="ghost"
          to={paths.adminUx("week", later)}
          control="admin.ux.week.later"
        >
          Week after
        </Button>
      )}
    </p>
  );
}

/** Tells the flag's success once, when a section first loads (CC-312: the owner opened it and it loaded). */
function useSuccessOnce(name, ready) {
  const { api } = useServices();
  const told = useRef(false);
  useEffect(() => {
    if (!ready || told.current) return;
    told.current = true;
    api.sendFlagSuccess(name).catch(() => undefined);
  }, [api, name, ready]);
}

/** One section's numbers, its loading shape and its failure. */
function SectionReport({ section, asked, week, yesterday }) {
  const report = useUxReport({ section, from: asked.from, to: asked.to });
  useSuccessOnce(section === "week" ? "console_ux_week" : "console_ux", report.status === "ready");
  if (report.status === "error" && isNotFound(report.error)) return <NotFoundPage />;
  const View = section === "week" ? UxWeek : VIEWS[section];
  const shown = report.report?.range;
  return (
    <>
      {report.status === "loading" && <Skeleton label="Counting the totals" shape="tile" count={4} />}
      {report.status === "error" && (
        <ErrorState
          title={report.error.message}
          control="admin.ux"
          onRetry={isRetryable(report.error) ? report.retry : undefined}
        />
      )}
      {shown !== undefined && (
        <>
          {section === "week" ? (
            <WeekPicker range={shown} lastWeek={week} />
          ) : (
            <RangePicker
              key={`${shown.from}|${shown.to}`}
              section={section}
              shown={shown}
              yesterday={yesterday}
            />
          )}
          <p className={consoleStyles.generated}>
            {shown.from} to {shown.to}, India time, against {report.report.before.from} to{" "}
            {report.report.before.to}. Worked out from the daily totals, refreshed every 5 minutes. Totals
            under 5 show as “fewer than 5”.
          </p>
          <Sections>
            <View report={report.report} />
          </Sections>
        </>
      )}
    </>
  );
}

/**
 * The owner's UX page (CC-177): how the site is used, from anonymous daily totals (CC-176), in sections reached by
 * tabs, each for a range against the range before. Only an admin reaches it (AdminRoute, and the server again), and
 * only while `console_ux` is on. The Week view (CC-313) is behind `console_ux_week` and opens by default on Mondays.
 */
export function UxPage() {
  const { section: uxSection } = useParams();
  const [search] = useSearchParams();
  const on = useFlagState("console_ux");
  const weekState = useFlagState("console_ux_week");
  const weekOn = weekState === FLAG_STATES.ON;
  const now = useNow(60_000);
  const today = indiaToday(now);
  const yesterday = addDays(today, -1);
  const lastMonday = addDays(today, -(((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 7));
  const lastWeek = { from: lastMonday, to: addDays(lastMonday, 6) };
  const section = uxSection ?? (weekOn && isMonday(today) ? "week" : "funnels");
  const asked = { from: search.get("from") ?? undefined, to: search.get("to") ?? undefined };

  if (!UX_SECTIONS.includes(section)) return <NotFoundPage />;
  const sections = UX_SECTIONS.filter((id) => id !== "week" || weekOn);
  const title = UX_SECTION_NAMES[section];
  return (
    <section className={consoleStyles.page} aria-labelledby="ux-title">
      <title>{`${title} · UX · Owner console · ${SITE_NAME}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <PageHeader
        id="ux-title"
        title="UX"
        lede="How the site is used, from anonymous daily totals: no names, no ids, and every total under 5 shown as “fewer than 5”. Days are India time."
      />
      <ConsoleTabs current="ux" />
      {/* Without a section in the address the default waits for the week's flag: on a Monday it is the week. */}
      {(on === FLAG_STATES.UNKNOWN ||
        (on === FLAG_STATES.ON && uxSection === undefined && weekState === FLAG_STATES.UNKNOWN)) && (
        <Skeleton label="Checking the UX page's flags" shape="block" />
      )}
      {on === FLAG_STATES.OFF && (
        <p className={consoleStyles.status}>
          This page is behind the console_ux flag, which is off for you. Turn it on from the{" "}
          <Link to={paths.adminFlags()}>Flags</Link> page.
        </p>
      )}
      {on === FLAG_STATES.ON && (uxSection !== undefined || weekState !== FLAG_STATES.UNKNOWN) && (
        <>
          <Tabs
            label="UX sections"
            control="admin.ux.tab"
            current={section}
            className={styles.sections}
            items={sections.map((id) => ({
              id,
              label: UX_SECTION_NAMES[id],
              // A section keeps the range shown, so moving between them compares the same days. The week has its own.
              to: paths.adminUx(id, id === "week" ? {} : asked),
            }))}
          />
          <p className={styles.lede}>{UX_SECTION_LEDES[section]}</p>
          {section === "week" && !weekOn ? (
            <p className={consoleStyles.status}>
              The Week view is behind the console_ux_week flag, which is off for you.
            </p>
          ) : (
            <SectionReport
              key={`${section}|${asked.from ?? ""}|${asked.to ?? ""}`}
              section={section}
              asked={asked}
              week={lastWeek}
              yesterday={yesterday}
            />
          )}
        </>
      )}
    </section>
  );
}
