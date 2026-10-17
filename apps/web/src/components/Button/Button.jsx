import { useId } from "react";
import { useExplanation } from "../../hooks/useExplanation.js";
import { ACTION_PHASES } from "../../hooks/useAction.js";
import styles from "./Button.module.css";

/**
 * The words a button shows while its action waits, and the spinner beside them. The label stays in the button
 * underneath, hidden, so the button keeps its width and nothing around it jumps.
 */
function Layers({ action, pendingLabel, doneLabel, children }) {
  const pending = action.phase === ACTION_PHASES.PENDING;
  const done = action.phase === ACTION_PHASES.DONE && doneLabel !== "";
  const hide = (hidden) => (hidden ? "true" : undefined);
  return (
    <span className={styles.stack}>
      <span className={styles.layer} aria-hidden={hide(pending || done)}>
        {children}
      </span>
      <span className={styles.layer} aria-hidden={hide(!pending)}>
        <span className={styles.spinner} aria-hidden="true" />
        {pendingLabel}
      </span>
      {doneLabel !== "" && (
        <span className={styles.layer} aria-hidden={hide(!done)}>
          <span className={styles.check} aria-hidden="true">
            ✓
          </span>
          {doneLabel}
        </span>
      )}
    </span>
  );
}

/**
 * What went wrong with the last press, under the button, with Retry when trying again can help.
 *
 * @param {{ action: ReturnType<typeof import("../../hooks/useAction.js").useAction>, control: string }} props
 */
function Failure({ action, control }) {
  return (
    <span className={styles.failure} role="alert">
      {action.error.message}
      {action.error.retryable && (
        <button
          type="button"
          className={styles.retry}
          data-cc-control={`${control}.retry`}
          data-sound="click"
          onClick={() => action.retry()}
        >
          Retry
        </button>
      )}
    </span>
  );
}

/**
 * The app's button, with the feedback every press gets (CC-164, docs/ux/MATCH_EXPERIENCE.md):
 *
 * 1. Pressed: the face goes down at once, and the subtle click sound plays (CC-103) unless `data-sound` says
 *    otherwise.
 * 2. Waiting: with an `action` (see useAction) still on its way after 400 ms, a spinner and `pendingLabel` take
 *    the label's place and the button is marked busy. Once shown they stay at least 300 ms, so they never flash.
 * 3. Done: the change the press made is the answer. Where nothing else changes, `doneLabel` shows with a check
 *    for a moment.
 * 4. Disabled with a reason: with a `reason` the button cannot act but stays focusable. The reason shows on
 *    hover and focus, and a press shows and announces it instead of doing nothing.
 * 5. Failed: the reason shows under the button, with Retry when trying again can help.
 *
 * Every button has a `control` name, written to `data-cc-control`, so tests and telemetry can find it.
 * A press runs `onClick` when given, otherwise the action. A submit button leaves the press to its form.
 *
 * @param {{
 *   control: string,
 *   variant?: "primary" | "accent" | "secondary" | "ghost",
 *   size?: "md" | "lg",
 *   action?: ReturnType<typeof import("../../hooks/useAction.js").useAction>,
 *   reason?: string,
 *   pendingLabel?: string,
 *   doneLabel?: string,
 * } & import("react").ButtonHTMLAttributes<HTMLButtonElement>} props
 *   `reason`: why the button cannot act now, empty when it can
 */
export function Button({
  control,
  variant = "primary",
  size = "md",
  action,
  reason = "",
  pendingLabel = "Sending…",
  doneLabel = "",
  type = "button",
  onClick,
  children,
  className = "",
  ...rest
}) {
  const tipId = useId();
  const explanation = useExplanation();
  const blocked = reason !== "";
  const pending = action?.phase === ACTION_PHASES.PENDING;

  function press(event) {
    if (blocked) {
      // A blocked submit button must not send its form.
      event.preventDefault();
      explanation.explain(reason);
      return;
    }
    if (onClick !== undefined) {
      onClick(event);
    } else if (action !== undefined && type !== "submit") {
      action.run();
    }
  }

  const explained = blocked && explanation.reason !== "";
  return (
    <span className={styles.control}>
      <button
        type={type}
        className={`${styles.button} ${styles[variant]} ${styles[size]} ${className}`}
        aria-disabled={blocked ? "true" : undefined}
        aria-describedby={blocked ? tipId : undefined}
        aria-busy={pending ? "true" : undefined}
        data-cc-control={control}
        data-sound="click"
        onClick={press}
        {...rest}
      >
        {action === undefined ? (
          children
        ) : (
          <Layers action={action} pendingLabel={pendingLabel} doneLabel={doneLabel}>
            {children}
          </Layers>
        )}
      </button>
      {blocked && (
        <span id={tipId} className={`${styles.tip} ${explained ? styles.shown : ""}`}>
          {reason}
        </span>
      )}
      {blocked && (
        <span className="visually-hidden" role="status">
          {explained && <span key={explanation.count}>{reason}</span>}
        </span>
      )}
      {action?.phase === ACTION_PHASES.FAILED && <Failure action={action} control={control} />}
    </span>
  );
}
