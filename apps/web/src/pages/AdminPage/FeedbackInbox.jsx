import { Link, useNavigate, useSearchParams } from "react-router";
import { FEEDBACK_STATUSES, FEEDBACK_TYPES, SITE_NAME } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { Button } from "../../components/Button/Button.jsx";
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS } from "../../components/Feedback/feedbackText.js";
import { useAction } from "../../hooks/useAction.js";
import { useFeedbackInbox } from "../../hooks/useFeedbackInbox.js";
import { isNotFound, isRetryable } from "../../lib/errors.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import consoleStyles from "./AdminPage.module.css";
import styles from "./FeedbackInbox.module.css";

/** When an item was sent, in India time, as the rest of the console shows days. */
const sentAt = (ms) =>
  new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** A filter of the inbox: all, or one value of a list. A change is a new address, so Back returns to the last one. */
function Filter({ label, name, value, options, labels, onChange }) {
  return (
    <label className={consoleStyles.rangeField}>
      {label}
      <select
        value={value ?? ""}
        onChange={(event) => onChange(name, event.target.value)}
        data-cc-control={`admin.feedback.${name}`}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A button that moves one item to another status. */
function StatusButton({ item, status, setStatus }) {
  const action = useAction(() => setStatus(item.feedbackId, status), {
    id: `admin.feedback.mark_${status}`,
  });
  return (
    <Button control={`admin.feedback.mark_${status}`} variant="secondary" action={action}>
      {`Mark ${FEEDBACK_STATUS_LABELS[status].toLowerCase()}`}
    </Button>
  );
}

/**
 * One item. Every value is React text, so a message or an email holding markup shows as the characters typed and
 * is never read as HTML (CC-290).
 */
function Entry({ item, setStatus }) {
  return (
    <article className={styles.entry} aria-labelledby={`feedback-${item.feedbackId}`}>
      <header className={styles.entryHeader}>
        <span id={`feedback-${item.feedbackId}`} className={`${styles.badge} ${styles[`type_${item.type}`]}`}>
          {FEEDBACK_TYPE_LABELS[item.type]}
        </span>
        <span className={`${styles.badge} ${styles.status}`}>{FEEDBACK_STATUS_LABELS[item.status]}</span>
        <time dateTime={new Date(item.createdAt).toISOString()} className={styles.time}>
          {sentAt(item.createdAt)}
        </time>
      </header>
      <p className={styles.message}>{item.message}</p>
      <dl className={styles.context}>
        <div>
          <dt>Page</dt>
          <dd>{item.page}</dd>
        </div>
        <div>
          <dt>Device</dt>
          <dd>{item.device}</dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>{item.kind}</dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd>{item.build}</dd>
        </div>
      </dl>
      {item.replyEmail !== undefined && <p className={styles.reply}>Reply to {item.replyEmail}</p>}
      <div className={styles.actions}>
        {FEEDBACK_STATUSES.filter((status) => status !== item.status).map((status) => (
          <StatusButton key={status} item={item} status={status} setStatus={setStatus} />
        ))}
      </div>
    </article>
  );
}

/**
 * The owner console's feedback inbox (CC-290): newest first, filtered by type and status in the address, 50 at a
 * time. Only an admin reaches this page (AdminRoute), and the server checks again on every request.
 */
export function FeedbackInbox() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const filters = { type: search.get("type") ?? undefined, status: search.get("status") ?? undefined };
  const inbox = useFeedbackInbox(filters);
  const older = useAction(inbox.loadOlder, { id: "admin.feedback.older" });

  if (inbox.status === "error" && isNotFound(inbox.error)) {
    return <NotFoundPage />;
  }
  const change = (name, value) =>
    navigate(paths.adminFeedback({ ...filters, [name]: value === "" ? undefined : value }));
  return (
    <section className={consoleStyles.page} aria-labelledby="feedback-title">
      <title>{`Feedback · Owner console · ${SITE_NAME}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <header className={consoleStyles.header}>
        <h1 id="feedback-title">Feedback</h1>
        <p className={consoleStyles.lede}>
          What players sent from the Feedback button. No player ids or addresses are stored, and every item is
          deleted 180 days after it was sent.
        </p>
      </header>
      <nav aria-label="Console sections">
        <ul className={consoleStyles.tabs}>
          <li>
            <Link to={paths.admin()} className={consoleStyles.tab} data-cc-control="admin.tab.totals">
              Totals
            </Link>
          </li>
          <li>
            <Link
              to={paths.adminFeedback()}
              className={consoleStyles.tab}
              aria-current="page"
              data-cc-control="admin.tab.feedback"
            >
              Feedback
            </Link>
          </li>
        </ul>
      </nav>
      <form className={consoleStyles.range} aria-label="Filters" onSubmit={(event) => event.preventDefault()}>
        <Filter
          label="Type"
          name="type"
          value={filters.type}
          options={FEEDBACK_TYPES}
          labels={FEEDBACK_TYPE_LABELS}
          onChange={change}
        />
        <Filter
          label="Status"
          name="status"
          value={filters.status}
          options={FEEDBACK_STATUSES}
          labels={FEEDBACK_STATUS_LABELS}
          onChange={change}
        />
      </form>
      {inbox.status === "loading" && (
        <p className={consoleStyles.status} role="status">
          Loading…
        </p>
      )}
      {inbox.status === "error" && (
        <div className={consoleStyles.status} role="alert">
          <p>{inbox.error.message}</p>
          {isRetryable(inbox.error) && (
            <Button control="admin.feedback.retry" variant="secondary" onClick={inbox.retry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {inbox.status === "ready" && inbox.items.length === 0 && <p>No feedback here yet.</p>}
      {inbox.items.length > 0 && (
        <ol className={styles.list}>
          {inbox.items.map((item) => (
            <li key={item.feedbackId}>
              <Entry item={item} setStatus={inbox.setStatus} />
            </li>
          ))}
        </ol>
      )}
      {inbox.next !== undefined && (
        <Button control="admin.feedback.older" variant="secondary" action={older}>
          Older
        </Button>
      )}
    </section>
  );
}
