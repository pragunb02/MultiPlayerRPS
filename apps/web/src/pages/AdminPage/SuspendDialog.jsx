import { useId, useState } from "react";
import { SUSPENSION_DURATION, SUSPENSION_DURATIONS, SUSPENSION_REASONS } from "@classicade/shared";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { useAction } from "../../hooks/useAction.js";
import { endsText, SUSPENSION_DURATION_LABELS, SUSPENSION_REASON_LABELS } from "./suspensionText.js";
import styles from "./SuspendDialog.module.css";

/**
 * Suspend, after the owner picks how long and why (CC-334, ADR-078): four durations, shortest first and picked, and
 * a closed list of reasons with none picked, so a reason is always a choice. There is no box to type in.
 *
 * @param {{ name: string, suspend: (choice: { duration: string, reason: string }) => Promise<{ suspension: object }>, onDone: (notice: string) => void }} props
 */
export function SuspendButton({ name, suspend, onDone }) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(SUSPENSION_DURATION.DAY);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  const ids = useId();
  const confirm = useAction(
    async () => {
      if (reason === "") {
        setMissing(true);
        return;
      }
      const { suspension } = await suspend({ duration, reason });
      setOpen(false);
      onDone(`${name} is suspended ${endsText(suspension)}.`);
    },
    { id: "admin.reports.suspend.confirm" },
  );
  const close = () => {
    setOpen(false);
    setMissing(false);
  };
  return (
    <>
      <Button control="admin.reports.suspend" variant="secondary" onClick={() => setOpen(true)}>
        Suspend
      </Button>
      <Modal
        open={open}
        title={`Suspend ${name}?`}
        onClose={close}
        actions={
          <>
            <Button control="admin.reports.suspend.cancel" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button control="admin.reports.suspend.confirm" variant="primary" action={confirm}>
              {`Suspend ${name}`}
            </Button>
          </>
        }
      >
        <p>
          The account is signed out everywhere at once, leaves its rooms (a game in progress is lost), and its
          challenges and friend requests end. Its rows leave the leaderboards until the suspension ends.
          Nothing is deleted. Nobody who reported is told, and the player is not told who reported.
        </p>
        <fieldset className={styles.choices}>
          <legend>For how long</legend>
          {SUSPENSION_DURATIONS.map((value) => (
            <label key={value} className={styles.choice}>
              <input
                type="radio"
                name={`${ids}-duration`}
                value={value}
                checked={duration === value}
                onChange={() => setDuration(value)}
                data-cc-control={`admin.reports.suspend.duration.${value}`}
              />
              {SUSPENSION_DURATION_LABELS[value]}
            </label>
          ))}
        </fieldset>
        <label className={styles.reason}>
          Reason
          <select
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setMissing(false);
            }}
            aria-describedby={missing ? `${ids}-missing` : undefined}
            data-cc-control="admin.reports.suspend.reason"
          >
            <option value="">Pick a reason</option>
            {SUSPENSION_REASONS.map((value) => (
              <option key={value} value={value}>
                {SUSPENSION_REASON_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        {missing && (
          <p id={`${ids}-missing`} role="alert" className={styles.missing}>
            Pick a reason first.
          </p>
        )}
      </Modal>
    </>
  );
}
