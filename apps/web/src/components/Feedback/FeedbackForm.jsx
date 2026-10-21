import { useCallback, useEffect, useId, useState } from "react";
import { useLocation } from "react-router";
import { FEEDBACK_DEFAULT_TYPE, FEEDBACK_MESSAGE_MAX, FEEDBACK_TYPES } from "@classicade/shared";
import { APP_BUILD } from "../../app/build.js";
import { useServices } from "../../app/servicesContext.js";
import { useAction } from "../../hooks/useAction.js";
import { Button } from "../Button/Button.jsx";
import { Field } from "../Field/Field.jsx";
import { Modal } from "../Modal/Modal.jsx";
import { currentDevice, feedbackPage } from "./feedbackContext.js";
import { FEEDBACK_TEXT, FEEDBACK_TYPE_LABELS } from "./feedbackText.js";
import styles from "./FeedbackDialog.module.css";

const EMPTY = Object.freeze({ type: FEEDBACK_DEFAULT_TYPE, message: "", replyEmail: "" });

/** A Hinglish line with its English line under it, as CC-217 shows them. */
function Lines({ text, className = "" }) {
  return (
    <span className={`${styles.lines} ${className}`}>
      <span lang="hi-Latn" className={styles.hinglish}>
        {text.hinglish}
      </span>
      <span>{text.english}</span>
    </span>
  );
}

/**
 * Whether this player may leave an email for a reply. Only the server knows (adults only, ADR-059), so the dialog
 * asks each time it opens. Until the answer comes, or when the question fails, there is no email field, so a
 * player who may not leave one is never shown it.
 */
function useReplyEmail(open) {
  const { api } = useServices();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api.getFeedbackForm().then(
      (form) => !cancelled && setAllowed(form.replyEmail === true),
      () => !cancelled && setAllowed(false),
    );
    return () => {
      cancelled = true;
    };
  }, [api, open]);
  // Forgotten when the dialog closes, so the next opening shows no email field until the server answers again.
  const forget = useCallback(() => setAllowed(false), []);
  return [allowed, forget];
}

/**
 * The Feedback dialog (CC-290): a type, a message of at most 1000 characters with a live count, an optional reply
 * email for adults, then a thank-you. It attaches the page's route pattern, the build and a coarse device class, and
 * nothing that says who the player is. The message is kept while the dialog is closed, until it is sent. The page
 * draws a new dialog for each player, so on a shared phone the next person never sees a draft or an email.
 *
 * @param {{ open: boolean, onClose: () => void }} props
 */
export function FeedbackForm({ open, onClose }) {
  const { api } = useServices();
  const { pathname } = useLocation();
  const [replyEmailAllowed, forgetReplyEmail] = useReplyEmail(open);
  const [draft, setDraft] = useState(EMPTY);
  const [missing, setMissing] = useState(false);
  const [sent, setSent] = useState(false);
  const formId = useId();

  const send = useAction(
    async () => {
      const replyEmail = draft.replyEmail.trim();
      await api.sendFeedback({
        type: draft.type,
        message: draft.message,
        page: feedbackPage(pathname),
        build: APP_BUILD,
        device: currentDevice(window),
        ...(replyEmailAllowed && replyEmail !== "" && { replyEmail }),
      });
      setDraft(EMPTY);
      setSent(true);
    },
    { id: "feedback.send" },
  );

  const update = (field) => (event) => {
    if (field === "message") setMissing(false);
    setDraft((current) => ({ ...current, [field]: event.target.value }));
  };

  function submit(event) {
    event.preventDefault();
    if (draft.message.trim() === "") {
      setMissing(true);
      return;
    }
    send.run();
  }

  function close() {
    forgetReplyEmail();
    setSent(false);
    onClose();
  }

  if (sent) {
    return (
      // A dialog of its own, so the focus moves to its first button: the one that was pressed has gone.
      <Modal
        surface="dialog.feedback"
        key="sent"
        open={open}
        title={<Lines text={FEEDBACK_TEXT.sentTitle} />}
        onClose={close}
        actions={
          <>
            <Button control="feedback.another" variant="secondary" onClick={() => setSent(false)}>
              {FEEDBACK_TEXT.another}
            </Button>
            <Button control="feedback.close" variant="primary" onClick={close}>
              {FEEDBACK_TEXT.close}
            </Button>
          </>
        }
      >
        <p className={styles.thanks}>
          <Lines text={FEEDBACK_TEXT.sentBody} />
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      surface="dialog.feedback"
      key="form"
      open={open}
      title={<Lines text={FEEDBACK_TEXT.title} />}
      onClose={close}
      actions={
        <>
          <Button control="feedback.cancel" variant="ghost" onClick={close}>
            {FEEDBACK_TEXT.cancel}
          </Button>
          <Button
            control="feedback.send"
            type="submit"
            form={formId}
            action={send}
            pendingLabel={FEEDBACK_TEXT.sending}
          >
            {FEEDBACK_TEXT.send}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        <fieldset className={styles.types}>
          <legend>
            <Lines text={FEEDBACK_TEXT.typeLegend} />
          </legend>
          {FEEDBACK_TYPES.map((type) => (
            <label key={type} className={styles.type}>
              <input
                type="radio"
                name="feedback-type"
                value={type}
                checked={draft.type === type}
                onChange={update("type")}
                data-cc-control={`feedback.type.${type}`}
                data-autofocus={draft.type === type ? "" : undefined}
              />
              <span>{FEEDBACK_TYPE_LABELS[type]}</span>
            </label>
          ))}
        </fieldset>
        <Field
          label={FEEDBACK_TEXT.messageLabel}
          kind="textarea"
          rows={5}
          maxLength={FEEDBACK_MESSAGE_MAX}
          required
          value={draft.message}
          onChange={update("message")}
          hint={<Lines text={FEEDBACK_TEXT.messageHint} />}
          error={missing ? <Lines text={FEEDBACK_TEXT.messageMissing} /> : ""}
          data-cc-control="feedback.message"
        />
        {replyEmailAllowed && (
          <Field
            label={FEEDBACK_TEXT.replyLabel}
            type="email"
            autoComplete="email"
            value={draft.replyEmail}
            onChange={update("replyEmail")}
            hint={`${FEEDBACK_TEXT.replyHint.hinglish} ${FEEDBACK_TEXT.replyHint.english}`}
            data-cc-control="feedback.reply_email"
          />
        )}
        <p className={styles.context}>
          <Lines text={FEEDBACK_TEXT.context} />
        </p>
      </form>
    </Modal>
  );
}
