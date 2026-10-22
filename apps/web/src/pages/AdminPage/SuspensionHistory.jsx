import { useEffect, useState } from "react";
import { useServices } from "../../app/servicesContext.js";
import { Button } from "../../components/Button/Button.jsx";
import { Modal } from "../../components/Modal/Modal.jsx";
import { useAction } from "../../hooks/useAction.js";
import { isRetryable } from "../../lib/errors.js";
import {
  endsText,
  indiaTime,
  SUSPENSION_DURATION_LABELS,
  SUSPENSION_REASON_LABELS,
} from "./suspensionText.js";
import styles from "./SuspendDialog.module.css";

/**
 * One suspension as the console shows it (CC-334): how long, why, who acted and when, and whether it is in effect.
 * Every value is React text. No id is shown.
 */
function Row({ suspension, children }) {
  return (
    <li>
      <strong>
        {`${SUSPENSION_DURATION_LABELS[suspension.duration]} · ${SUSPENSION_REASON_LABELS[suspension.reason]}`}
      </strong>
      {suspension.active && <span> · In effect</span>}
      <p>{`Started ${indiaTime(suspension.startedAt)} by ${suspension.byName}, ${endsText(suspension)}`}</p>
      {suspension.liftedAt !== undefined && (
        <p>{`Lifted ${indiaTime(suspension.liftedAt)} by ${suspension.liftedByName}`}</p>
      )}
      {children}
    </li>
  );
}

/**
 * A group's History button: the reported player's suspensions, newest first, read when it opens (CC-334, AC-8).
 *
 * @param {{ groupId: string, name: string }} props
 */
export function HistoryButton({ groupId, name }) {
  const { api } = useServices();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: "loading", suspensions: [], error: undefined });
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    api.getSuspensionHistory(groupId).then(
      (suspensions) => !cancelled && setState({ status: "ready", suspensions, error: undefined }),
      (error) => !cancelled && setState({ status: "error", suspensions: [], error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, groupId, open]);
  return (
    <>
      <Button
        control="admin.reports.history"
        variant="ghost"
        aria-expanded={open}
        onClick={() => {
          // Read afresh each time it opens.
          if (!open) setState({ status: "loading", suspensions: [], error: undefined });
          setOpen(!open);
        }}
      >
        History
      </Button>
      {open && state.status === "loading" && <p>Loading…</p>}
      {open && state.status === "error" && <p role="alert">{state.error.message}</p>}
      {open && state.status === "ready" && state.suspensions.length === 0 && <p>Never suspended.</p>}
      {open && state.suspensions.length > 0 && (
        <ol className={styles.history} aria-label={`Suspensions of ${name}`}>
          {state.suspensions.map((suspension) => (
            <Row key={suspension.suspensionId} suspension={suspension} />
          ))}
        </ol>
      )}
    </>
  );
}

/** Lift, after the owner says yes. */
function LiftButton({ suspension, lift }) {
  const [asking, setAsking] = useState(false);
  const action = useAction(
    async () => {
      await lift(suspension);
      setAsking(false);
    },
    { id: "admin.suspensions.lift.confirm" },
  );
  return (
    <>
      <Button control="admin.suspensions.lift" variant="secondary" onClick={() => setAsking(true)}>
        {`Lift ${suspension.nameThen}'s suspension`}
      </Button>
      <Modal
        open={asking}
        title={`Lift ${suspension.nameThen}'s suspension?`}
        onClose={() => setAsking(false)}
        actions={
          <>
            <Button
              control="admin.suspensions.lift.cancel"
              variant="secondary"
              onClick={() => setAsking(false)}
            >
              Cancel
            </Button>
            <Button control="admin.suspensions.lift.confirm" variant="primary" action={action}>
              Lift the suspension
            </Button>
          </>
        }
      >
        <p>
          The player can sign in again at once and their leaderboard rows come back. Rooms they left and
          challenges that ended stay as they are. The player is not told.
        </p>
      </Modal>
    </>
  );
}

/**
 * The suspensions in effect now, so the owner can lift one whose reports are long gone (CC-334, AC-8).
 *
 * @param {{ onDone: (notice: string) => void, refresh: number }} props  `refresh` changes after a new suspension
 */
export function CurrentSuspensions({ onDone, refresh }) {
  const { api } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: "loading", suspensions: [], error: undefined });
  useEffect(() => {
    let cancelled = false;
    api.getCurrentSuspensions().then(
      (suspensions) => !cancelled && setState({ status: "ready", suspensions, error: undefined }),
      (error) => !cancelled && setState({ status: "error", suspensions: [], error }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, attempt, refresh]);
  const lift = async (suspension) => {
    await api.liftSuspension(suspension.suspensionId);
    setState((shown) => ({
      ...shown,
      suspensions: shown.suspensions.filter((each) => each.suspensionId !== suspension.suspensionId),
    }));
    onDone(`${suspension.nameThen}'s suspension is lifted.`);
  };
  return (
    <section aria-labelledby="suspended-now">
      <h2 id="suspended-now">Suspended now</h2>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && (
        <div role="alert">
          <p>{state.error.message}</p>
          {isRetryable(state.error) && (
            <Button
              control="admin.suspensions.retry"
              variant="secondary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Try again
            </Button>
          )}
        </div>
      )}
      {state.status === "ready" && state.suspensions.length === 0 && <p>Nobody is suspended now.</p>}
      {state.suspensions.length > 0 && (
        <ol className={styles.history} aria-label="Suspended now">
          {state.suspensions.map((suspension) => (
            <Row key={suspension.suspensionId} suspension={suspension}>
              <p>{suspension.nameThen}</p>
              <LiftButton suspension={suspension} lift={lift} />
            </Row>
          ))}
        </ol>
      )}
    </section>
  );
}
