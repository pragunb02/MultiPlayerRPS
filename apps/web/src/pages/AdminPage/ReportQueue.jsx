import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  REPORT_ACTION,
  REPORT_CONTEXT,
  REPORT_REASONS,
  REPORT_STATUS,
  REPORT_STATUSES,
  SITE_NAME,
} from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { REPORT_REASON_LABELS } from "../../components/Report/reportText.js";
import { useAction } from "../../hooks/useAction.js";
import { useReportQueue } from "../../hooks/useReportQueue.js";
import { isNotFound, isRetryable } from "../../lib/errors.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import { ConsoleTabs } from "./ConsoleTabs.jsx";
import consoleStyles from "./AdminPage.module.css";
import styles from "./FeedbackInbox.module.css";

/** The name of each status in the console's filter. */
const STATUS_LABELS = Object.freeze({
  [REPORT_STATUS.OPEN]: "Open",
  [REPORT_STATUS.DISMISSED]: "Dismissed",
  [REPORT_STATUS.ACTIONED]: "Acted on",
});

/** When a report was made, in India time, as the rest of the console shows days. */
const madeAt = (ms) =>
  new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Where a report was made: a room, a match or a profile, with the game. */
function where({ kind, gameId, roomCode, matchId }) {
  if (kind === REPORT_CONTEXT.ROOM) return `Room ${roomCode} · ${gameId}`;
  if (kind === REPORT_CONTEXT.MATCH) return `Match ${matchId} · ${gameId}`;
  return "Profile";
}

/** What happened between the two before the report, players named by role (ADR-071.3). */
function Recent({ recent }) {
  if (recent === undefined || recent.length === 0) return null;
  return (
    <ol className={styles.context} aria-label="Before the report">
      {recent.map((entry, index) => (
        <li key={index}>{`${entry.by} ${entry.kind === "move" ? "moved" : "asked"} ${entry.text}`}</li>
      ))}
    </ol>
  );
}

/**
 * One report of a group. Every value is React text, so a note holding markup shows as the characters typed and is
 * never read as HTML.
 */
function Item({ item }) {
  return (
    <li className={styles.entry}>
      <header className={styles.entryHeader}>
        <span className={styles.badge}>{REPORT_REASON_LABELS[item.reason].english}</span>
        {item.setAside && <span className={`${styles.badge} ${styles.status}`}>set aside</span>}
        <time dateTime={new Date(item.createdAt).toISOString()} className={styles.time}>
          {madeAt(item.createdAt)}
        </time>
      </header>
      <dl className={styles.context}>
        <div>
          <dt>Where</dt>
          <dd>{where(item.context)}</dd>
        </div>
        <div>
          <dt>Name then</dt>
          <dd>{item.nameThen}</dd>
        </div>
      </dl>
      {item.note !== undefined && <p className={styles.message}>{item.note}</p>}
      <Recent recent={item.context.recent} />
    </li>
  );
}

/** Rename, after the owner says yes: the account gets a safe default name and is signed out everywhere. */
function RenameButton({ name, run }) {
  const [asking, setAsking] = useState(false);
  const action = useAction(run, { id: "admin.reports.rename.confirm" });
  return (
    <>
      <Button control="admin.reports.rename" variant="secondary" onClick={() => setAsking(true)}>
        Rename
      </Button>
      <Modal
        open={asking}
        title={`Rename ${name}?`}
        onClose={() => setAsking(false)}
        actions={
          <>
            <Button
              control="admin.reports.rename.cancel"
              variant="secondary"
              onClick={() => setAsking(false)}
            >
              Cancel
            </Button>
            <Button control="admin.reports.rename.confirm" variant="primary" action={action}>
              Rename to a safe name
            </Button>
          </>
        }
      >
        <p>
          The account gets a name like Player_ABC234, on every board too, and is signed out everywhere. The
          player is not told why. Every open report about them is closed.
        </p>
      </Modal>
    </>
  );
}

/** One reported player: the names seen, counts by reason, every report, and the actions. */
function Group({ group, open, act, onDone }) {
  const name = group.names.join(" / ");
  const dismiss = useAction(
    async () => {
      const { closed } = await act(group.groupId, REPORT_ACTION.DISMISS);
      onDone(`Dismissed ${plural(closed, "report")} about ${name}.`);
    },
    { id: "admin.reports.dismiss" },
  );
  const rename = async () => {
    const { displayName } = await act(group.groupId, REPORT_ACTION.RENAME);
    onDone(`${name} is now ${displayName}.`);
  };
  return (
    <article className={styles.entry} aria-labelledby={`group-${group.groupId}`}>
      <header className={styles.entryHeader}>
        <h2 id={`group-${group.groupId}`}>{name}</h2>
        <span className={`${styles.badge} ${styles.status}`}>{group.kind}</span>
        <time dateTime={new Date(group.lastAt).toISOString()} className={styles.time}>
          {madeAt(group.lastAt)}
        </time>
      </header>
      <p className={styles.message}>
        {`${plural(group.reports, "report")} from ${plural(group.reporters, "person").replace("persons", "people")}`}
        {group.setAside > 0 && ` · ${group.setAside} set aside`}
      </p>
      <dl className={styles.context} aria-label="Reasons">
        {REPORT_REASONS.map((reason) => (
          <div key={reason}>
            <dt>{REPORT_REASON_LABELS[reason].english}</dt>
            <dd>{group.reasons[reason]}</dd>
          </div>
        ))}
      </dl>
      <ol className={styles.list}>
        {group.items.map((item) => (
          <Item key={item.reportId} item={item} />
        ))}
      </ol>
      {open && (
        <div className={styles.actions}>
          <Button control="admin.reports.dismiss" variant="secondary" action={dismiss}>
            Dismiss
          </Button>
          {group.canRename && <RenameButton name={name} run={rename} />}
        </div>
      )}
    </article>
  );
}

/**
 * The owner console's report queue (CC-044, ADR-071.6): open reports grouped by reported player, the most reporters
 * first, filtered by status in the address. No player id reaches this page: a group is named by its newest report.
 * Only an admin reaches it (AdminRoute), and the server checks again on every request.
 */
export function ReportQueue() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const status = search.get("status") ?? undefined;
  const queue = useReportQueue(status);
  const [notice, setNotice] = useState("");

  if (queue.status === "error" && isNotFound(queue.error)) {
    return <NotFoundPage />;
  }
  const open = (status ?? REPORT_STATUS.OPEN) === REPORT_STATUS.OPEN;
  return (
    <section className={consoleStyles.page} aria-labelledby="reports-title">
      <title>{`Reports · Owner console · ${SITE_NAME}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <header className={consoleStyles.header}>
        <h1 id="reports-title">Reports</h1>
        <p className={consoleStyles.lede}>
          Reports players made about other players, one group per player, the most reporters first. Who
          reported is never shown, nobody is ever told, and every report is deleted 180 days after it was
          made.
        </p>
      </header>
      <ConsoleTabs current="reports" />
      <div className={consoleStyles.range} role="group" aria-label="Filters">
        <label className={consoleStyles.rangeField}>
          Status
          <select
            value={status ?? REPORT_STATUS.OPEN}
            onChange={(event) =>
              navigate(
                paths.adminReports({
                  status: event.target.value === REPORT_STATUS.OPEN ? undefined : event.target.value,
                }),
              )
            }
            data-cc-control="admin.reports.status"
          >
            {REPORT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p role="status" className={consoleStyles.status}>
        {notice}
      </p>
      {queue.status === "loading" && <p className={consoleStyles.status}>Loading…</p>}
      {queue.status === "error" && (
        <div className={consoleStyles.status} role="alert">
          <p>{queue.error.message}</p>
          {isRetryable(queue.error) && (
            <Button control="admin.reports.retry" variant="secondary" onClick={queue.retry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {queue.status === "ready" && queue.groups.length === 0 && <p>No reports here.</p>}
      {queue.groups.length > 0 && (
        <ol className={styles.list}>
          {queue.groups.map((group) => (
            <li key={group.groupId}>
              <Group group={group} open={open} act={queue.act} onDone={setNotice} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
