import { useEffect, useId, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { FEEDBACK_STATUSES, FEEDBACK_TYPES, SITE_NAME } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useServices } from "../../app/servicesContext.js";
import { Button } from "../../components/Button/Button.jsx";
import { Card, CardBody, CardFooter } from "../../components/Card/Card.jsx";
import { Field } from "../../components/Field/Field.jsx";
import { PageHeader, Section } from "../../components/Page/Page.jsx";
import { EmptyState, ErrorState, Skeleton } from "../../components/States/States.jsx";
import { FEEDBACK_STATUS_LABELS, FEEDBACK_TYPE_LABELS } from "../../components/Feedback/feedbackText.js";
import { Modal } from "../../components/Modal/Modal.jsx";
import { useAction } from "../../hooks/useAction.js";
import { useFeedbackInbox } from "../../hooks/useFeedbackInbox.js";
import { isNotFound, isRetryable } from "../../lib/errors.js";
import { NotFoundPage } from "../NotFoundPage/NotFoundPage.jsx";
import { ConsoleTabs } from "./ConsoleTabs.jsx";
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
    <Field
      label={label}
      kind="select"
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
    </Field>
  );
}

/** A button that moves one item to another status. */
function StatusButton({ item, status, setStatus }) {
  const action = useAction(() => setStatus(item.feedbackId, status), {
    id: `admin.feedback.mark_${status}`,
  });
  return (
    <Button control={`admin.feedback.mark_${status}`} variant="secondary" size="sm" action={action}>
      {`Mark ${FEEDBACK_STATUS_LABELS[status].toLowerCase()}`}
    </Button>
  );
}

/**
 * The item's own view: the reply email, which the list never shows (ADR-059). It is read from the server only
 * when the owner opens it, so the list's answer never carries an email.
 */
function Details({ feedbackId }) {
  const { api } = useServices();
  const [shown, setShown] = useState({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    api.getFeedbackItem(feedbackId).then(
      (item) => !cancelled && setShown({ status: "ready", item }),
      (error) => !cancelled && setShown({ status: "error", error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, feedbackId]);
  if (shown.status === "loading") return <Skeleton label="Loading the reply email" />;
  if (shown.status === "error")
    return <ErrorState title={shown.error.message} control="admin.feedback.details" />;
  return shown.item.replyEmail === undefined ? (
    <p className={styles.reply}>No reply email.</p>
  ) : (
    <p className={styles.reply}>Reply to {shown.item.replyEmail}</p>
  );
}

/** Delete, after the owner says yes, for an item that holds personal details. It cannot be undone. */
function DeleteButton({ item, remove }) {
  const [asking, setAsking] = useState(false);
  const action = useAction(() => remove(item.feedbackId), { id: "admin.feedback.delete.confirm" });
  return (
    <>
      <Button control="admin.feedback.delete" variant="danger" size="sm" onClick={() => setAsking(true)}>
        Delete
      </Button>
      <Modal
        surface="dialog.delete_feedback"
        open={asking}
        destructive
        title="Delete this feedback?"
        onClose={() => setAsking(false)}
        actions={
          <>
            <Button
              control="admin.feedback.delete.cancel"
              variant="secondary"
              onClick={() => setAsking(false)}
            >
              Cancel
            </Button>
            <Button control="admin.feedback.delete.confirm" variant="danger" action={action}>
              Delete for good
            </Button>
          </>
        }
      >
        <p>It is removed from the database at once and cannot be brought back.</p>
      </Modal>
    </>
  );
}

/**
 * One item. Every value is React text, so a message or an email holding markup shows as the characters typed and
 * is never read as HTML (CC-290).
 */
function Entry({ item, setStatus, remove }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <Card className={styles.entry} aria-labelledby={`feedback-${item.feedbackId}`}>
      <header className={styles.entryHeader}>
        <span id={`feedback-${item.feedbackId}`} className={`${styles.badge} ${styles[`type_${item.type}`]}`}>
          {FEEDBACK_TYPE_LABELS[item.type]}
        </span>
        <span className={`${styles.badge} ${styles.status}`}>{FEEDBACK_STATUS_LABELS[item.status]}</span>
        <time dateTime={new Date(item.createdAt).toISOString()} className={styles.time}>
          {sentAt(item.createdAt)}
        </time>
      </header>
      <CardBody>
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
        {item.hasReplyEmail && <p className={styles.hasReply}>Has a reply email</p>}
        <div id={detailsId}>{open && <Details feedbackId={item.feedbackId} />}</div>
      </CardBody>
      <CardFooter>
        <Button
          control="admin.feedback.details"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen(!open)}
        >
          Details
        </Button>
        {FEEDBACK_STATUSES.filter((status) => status !== item.status).map((status) => (
          <StatusButton key={status} item={item} status={status} setStatus={setStatus} />
        ))}
        <DeleteButton item={item} remove={remove} />
      </CardFooter>
    </Card>
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
      <PageHeader
        id="feedback-title"
        title="Feedback"
        lede="What players sent from the Feedback button. No player ids or addresses are stored, and every item is deleted 180 days after it was sent."
      />
      <ConsoleTabs current="feedback" />
      <Card as="div" role="group" aria-label="Filters">
        <div className={styles.filters}>
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
        </div>
      </Card>
      <Section title="Items" description="Newest first, 50 at a time. Times are India time.">
        {inbox.status === "loading" && <Skeleton label="Loading the feedback" shape="card" count={2} />}
        {inbox.status === "error" && (
          <ErrorState
            title={inbox.error.message}
            control="admin.feedback"
            onRetry={isRetryable(inbox.error) ? inbox.retry : undefined}
          />
        )}
        {inbox.status === "ready" && inbox.items.length === 0 && (
          <EmptyState title="Nothing here yet.">
            Items players send from the Feedback button show up here.
          </EmptyState>
        )}
        {inbox.items.length > 0 && (
          <ol className={styles.list}>
            {inbox.items.map((item) => (
              <li key={item.feedbackId}>
                <Entry item={item} setStatus={inbox.setStatus} remove={inbox.remove} />
              </li>
            ))}
          </ol>
        )}
        {inbox.next !== undefined && (
          <div>
            <Button control="admin.feedback.older" variant="secondary" action={older}>
              Older
            </Button>
          </div>
        )}
      </Section>
    </section>
  );
}
