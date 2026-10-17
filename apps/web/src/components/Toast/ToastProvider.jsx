import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { DismissButton } from "../DismissButton/DismissButton.jsx";
import { ToastContext } from "./toastContext.js";
import styles from "./Toast.module.css";

const DISPLAY_MS = 4_000;
/** A toast with a link stays twice as long: there is something to do, not just to read. */
const ACTION_FACTOR = 2;

/**
 * Renders toasts in a polite live region so screen readers announce them without stealing focus. A toast may carry
 * `art` (an icon drawn in front of the message, CC-087); it is decoration, hidden from screen readers — the message
 * says everything. It may also carry an `action` (a link, e.g. "Save it", CC-097) with a close button: the
 * region never takes clicks, only those two do, so a toast still can't cover a button. Closing calls `onDismiss`.
 */
export function ToastProvider({ children, displayMs = DISPLAY_MS }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const remove = useCallback((id) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const show = useCallback(
    (message, { tone = "info", art, action } = {}) => {
      const id = ++nextId.current;
      setToasts((current) => [...current, { id, message, tone, art, action }]);
      const timer = setTimeout(
        () => {
          timers.current.delete(timer);
          remove(id);
        },
        action ? displayMs * ACTION_FACTOR : displayMs,
      );
      timers.current.add(timer);
      return id;
    },
    [displayMs, remove],
  );

  const value = useMemo(() => ({ show, dismiss: remove }), [show, remove]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${styles[toast.tone]} ${toast.art ? styles.withArt : ""}`}
          >
            {toast.art && (
              <span className={styles.art} aria-hidden="true">
                {toast.art}
              </span>
            )}
            {toast.message}
            {toast.action && (
              <>
                <Link to={toast.action.to} className={styles.action} data-cc-control="toast.action">
                  {toast.action.label}
                </Link>
                <DismissButton
                  control="toast.dismiss"
                  label={toast.action.dismissLabel}
                  onClick={() => {
                    remove(toast.id);
                    toast.action.onDismiss();
                  }}
                />
              </>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
