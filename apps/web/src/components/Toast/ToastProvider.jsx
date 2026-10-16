import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToastContext } from "./toastContext.js";
import styles from "./Toast.module.css";

const DISPLAY_MS = 4_000;

/** Renders toasts in a polite live region so screen readers announce them without stealing focus. */
export function ToastProvider({ children, displayMs = DISPLAY_MS }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const timers = useRef(new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const show = useCallback(
    (message, { tone = "info" } = {}) => {
      const id = ++nextId.current;
      setToasts((current) => [...current, { id, message, tone }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, displayMs);
      timers.current.add(timer);
    },
    [displayMs],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`${styles.toast} ${styles[toast.tone]}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
