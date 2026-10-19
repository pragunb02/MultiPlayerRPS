import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { CATEGORIES, categoryOf } from "../../lib/notify/categories.js";
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
 *
 * Every toast belongs to a notification category (CC-208). The same message of a category is not shown twice
 * within the category's rate limit. While something more important is on screen (a request holds the request
 * category, see `hold`), toasts of lower categories wait and show once it is gone, so a question is never buried
 * under rewards. A toast's `onShow` runs when it really shows, so an effect or a sound that belongs to it (the
 * level-up burst) waits with it (CC-163).
 */
export function ToastProvider({ children, displayMs = DISPLAY_MS }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Set());
  const waiting = useRef([]);
  const holds = useRef(new Map());
  const recent = useRef(new Map());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const remove = useCallback((id) => {
    waiting.current = waiting.current.filter((toast) => toast.id !== id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  /** The highest priority of everything holding the screen right now, 0 for none. */
  const heldPriority = useCallback(
    () => Math.max(0, ...[...holds.current.keys()].map((id) => categoryOf(id).priority)),
    [],
  );

  const display = useCallback(
    (toast) => {
      setToasts((current) => [...current, toast]);
      toast.onShow?.();
      const timer = setTimeout(
        () => {
          timers.current.delete(timer);
          remove(toast.id);
        },
        toast.action ? displayMs * ACTION_FACTOR : displayMs,
      );
      timers.current.add(timer);
    },
    [displayMs, remove],
  );

  const show = useCallback(
    (message, { tone = "info", art, action, category = CATEGORIES.SYSTEM, onShow } = {}) => {
      const { priority, minGapMs } = categoryOf(category);
      const key = `${category}:${message}`;
      const last = recent.current.get(key);
      if (last !== undefined && Date.now() - last.at < minGapMs) {
        return last.id;
      }
      const id = ++nextId.current;
      recent.current.set(key, { id, at: Date.now() });
      const toast = { id, message, tone, art, action, priority, onShow };
      if (priority < heldPriority()) {
        waiting.current = [...waiting.current, toast];
      } else {
        display(toast);
      }
      return id;
    },
    [display, heldPriority],
  );

  /** Shows the waiting toasts that nothing holds back any more. */
  const release = useCallback(() => {
    const floor = heldPriority();
    const ready = waiting.current.filter((toast) => toast.priority >= floor);
    waiting.current = waiting.current.filter((toast) => toast.priority < floor);
    ready.forEach(display);
  }, [display, heldPriority]);

  const hold = useCallback(
    (category) => {
      categoryOf(category);
      holds.current.set(category, (holds.current.get(category) ?? 0) + 1);
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        const count = holds.current.get(category) - 1;
        if (count === 0) {
          holds.current.delete(category);
        } else {
          holds.current.set(category, count);
        }
        release();
      };
    },
    [release],
  );

  const value = useMemo(() => ({ show, dismiss: remove, hold }), [show, remove, hold]);

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
