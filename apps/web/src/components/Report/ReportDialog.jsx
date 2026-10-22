import { useId, useState } from "react";
import { REPORT_REASONS } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";
import { useAction } from "../../hooks/useAction.js";
import { Button } from "../Button/Button.jsx";
import { Modal } from "../Modal/Modal.jsx";
import { useToast } from "../Toast/toastContext.js";
import { REPORT_REASON_LABELS, reportText } from "./reportText.js";
import styles from "./ReportDialog.module.css";

/** A Hinglish line with its English line under it (ADR-051). */
function Lines({ text }) {
  return (
    <span className={styles.lines}>
      <span lang="hi-Latn" className={styles.hinglish}>
        {text.hinglish}
      </span>
      <span>{text.english}</span>
    </span>
  );
}

/**
 * The thank-you after a report, the same whatever happens next, with Block in one tap (ADR-071.4). The block names
 * the player by the report's id, so the page never holds anyone's player id.
 */
function Thanks({ name, reportId, canBlock, onBlocked, onClose }) {
  const { api } = useServices();
  const toast = useToast();
  const text = reportText(name);
  const [blocked, setBlocked] = useState(false);
  const block = useAction(
    async () => {
      await api.blockPlayer({ reportId });
      setBlocked(true);
      toast.show(text.blocked.english, { surface: "toast.blocked", tone: "info" });
      onBlocked();
    },
    { id: "report.block" },
  );
  return (
    <Modal
      surface="dialog.report"
      key="sent"
      open
      title={<Lines text={text.sentTitle} />}
      onClose={onClose}
      actions={
        <>
          {canBlock && !blocked && (
            <Button control="report.block" variant="secondary" action={block} pendingLabel={text.blocking}>
              {text.blockToo}
            </Button>
          )}
          <Button control="report.close" variant="primary" onClick={onClose}>
            {text.close}
          </Button>
        </>
      }
    >
      <div className={styles.thanks}>
        <p>
          <Lines text={text.sentBody} />
        </p>
        {blocked && (
          <p role="status">
            <Lines text={text.blocked} />
          </p>
        )}
        <p className={styles.help}>
          <Lines text={text.help} />
        </p>
      </div>
    </Modal>
  );
}

/**
 * Reporting one player (CC-044, ADR-071): one of four closed reasons, and no free text (owner, 2026-10-21), then a
 * neutral thank-you that says nothing about what happens to the other player, who is never told. The page
 * names the player only by where the two met: a room seat, a match seat or a profile handle.
 *
 * @param {{
 *   name: string,
 *   target: { roomCode: string, seat: number, seatId: string } | { matchId: string, seat: number } | { handle: string },
 *   canBlock: boolean,
 *   onBlocked: () => void,
 *   onClose: () => void,
 * }} props  `canBlock` is false when the viewer blocked the player already. `onBlocked` is told after a block from
 *   the thank-you
 */
export function ReportDialog({ name, target, canBlock, onBlocked, onClose }) {
  const { api } = useServices();
  const text = reportText(name);
  const [reason, setReason] = useState(undefined);
  const [missing, setMissing] = useState(false);
  const [sent, setSent] = useState(undefined);
  const formId = useId();
  const errorId = useId();

  const send = useAction(
    async () => {
      setSent(await api.reportPlayer({ ...target, reason }));
    },
    { id: "report.send" },
  );

  function submit(event) {
    event.preventDefault();
    if (reason === undefined) {
      setMissing(true);
      return;
    }
    send.run();
  }

  if (sent !== undefined) {
    return (
      <Thanks
        name={name}
        reportId={sent.reportId}
        canBlock={canBlock}
        onBlocked={onBlocked}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      surface="dialog.report"
      key="form"
      open
      title={<Lines text={text.title} />}
      onClose={onClose}
      actions={
        <>
          <Button control="report.cancel" variant="ghost" onClick={onClose}>
            {text.cancel}
          </Button>
          <Button control="report.send" type="submit" form={formId} action={send} pendingLabel={text.sending}>
            {text.send}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <fieldset className={styles.reasons} aria-describedby={missing ? errorId : undefined}>
          <legend>
            <Lines text={text.reasonLegend} />
          </legend>
          {REPORT_REASONS.map((id, index) => (
            <label key={id} className={styles.reason}>
              <input
                type="radio"
                name="report-reason"
                value={id}
                checked={reason === id}
                onChange={() => {
                  setReason(id);
                  setMissing(false);
                }}
                data-cc-control={`report.reason.${id}`}
                data-autofocus={index === 0 ? "" : undefined}
              />
              <Lines text={REPORT_REASON_LABELS[id]} />
            </label>
          ))}
          {missing && (
            <p id={errorId} className={styles.error}>
              <Lines text={text.reasonMissing} />
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
