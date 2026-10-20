import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { surfaceNamed } from "@classicade/shared";
import { ServicesContext } from "../../app/servicesContext.js";
import { NO_INTERRUPTIONS } from "../../lib/telemetry/interruptions.js";
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
 *
 * Every toast names its registered `surface` (CC-313), and is counted from when it really shows until it goes: by
 * its time (`timed_out`), its close button (`dismissed`) or its link (`acted`). A toast that waited and never showed
 * is not counted.
 */
export function ToastProvider({ children, displayMs = DISPLAY_MS }) {
  const interruptions = useContext(ServicesContext)?.interruptions ?? NO_INTERRUPTIONS;
  const [toasts, setToasts] = useState([]);
  const shown = useRef(new Map());
  const nextId = useRef(0);
  const timers = useRef(new Set());
  const waiting = useRef([]);
  const holds = useRef(new Map());
  const recent = useRef(new Map());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  /** Takes a toast away. How it ended was marked on its handle before, or it was dismissed. */
  const remove = useCallback((id, outcome = "dismissed") => {
    waiting.current = waiting.current.filter((toast) => toast.id !== id);
    shown.current.get(id)?.end(outcome);
    shown.current.delete(id);
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
      shown.current.set(toast.id, interruptions.open(toast.surface));
      toast.onShow?.();
      const timer = setTimeout(
        () => {
          timers.current.delete(timer);
          remove(toast.id, "timed_out");
        },
        toast.action ? displayMs * ACTION_FACTOR : displayMs,
      );
      timers.current.add(timer);
    },
    [displayMs, remove, interruptions],
  );

  const show = useCallback(
    (message, { surface, tone = "info", art, action, category = CATEGORIES.SYSTEM, onShow } = {}) => {
      surfaceNamed(surface);
      const { priority, minGapMs } = categoryOf(category);
      const key = `${category}:${message}`;
      const last = recent.current.get(key);
      if (last !== undefined && Date.now() - last.at < minGapMs) {
        return last.id;
      }
      const id = ++nextId.current;
      recent.current.set(key, { id, at: Date.now() });
      const toast = { id, surface, message, tone, art, action, priority, onShow };
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
            data-cc-surface={toast.surface}
          >
            {toast.art && (
              <span className={styles.art} aria-hidden="true">
                {toast.art}
              </span>
            )}
            {toast.message}
            {toast.action && (
              <>
                <Link
                  to={toast.action.to}
                  className={styles.action}
                  data-cc-control="toast.action"
                  onClick={() => remove(toast.id, "acted")}
                >
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
