import { useState } from "react";
import { useServices } from "../../app/servicesContext.js";
import { Button } from "../../components/Button/Button.jsx";
import { FeedbackDialog } from "../../components/Feedback/FeedbackDialog.jsx";
import { useAction } from "../../hooks/useAction.js";
import styles from "../authForms.module.css";

/** When the suspension ends, in India time, the site's time for every date. */
const untilText = (endsAt) =>
  endsAt === undefined
    ? "Your account is paused until the ClassiCade team lifts it."
    : `Your account is paused until ${new Date(endsAt).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })} (India time).`;

/**
 * What a suspended account sees instead of signing in (CC-334, ADR-078 decision 2): when it ends, and how to appeal
 * through the feedback form. Nothing about a report, a reason or anyone else. It can still download its data with the
 * email and password it typed (decision 7).
 *
 * @param {{ endsAt?: number, credentials: { email: string, password: string } }} props
 */
export function SuspendedNotice({ endsAt, credentials }) {
  const { api, download } = useServices();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const exportData = useAction(
    async () => {
      const data = await api.exportSuspendedData(credentials);
      download.saveJson({ filename: `classicade-data-${data.exportedAt.slice(0, 10)}.json`, data });
      setDownloaded(true);
    },
    { id: "auth.suspended.export" },
  );
  return (
    <section className={styles.paused} aria-labelledby="paused-title">
      <h2 id="paused-title">Your account is paused</h2>
      <p>{untilText(endsAt)}</p>
      <p>You can log in again after that. Your games and progress are kept.</p>
      <p>If you think this is a mistake, tell us through the feedback form.</p>
      <Button control="auth.suspended.feedback" variant="secondary" onClick={() => setFeedbackOpen(true)}>
        Tell us through the feedback form
      </Button>
      <Button control="auth.suspended.export" variant="ghost" action={exportData}>
        Download my data
      </Button>
      {downloaded && <p role="status">Your data file is downloading.</p>}
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </section>
  );
}
