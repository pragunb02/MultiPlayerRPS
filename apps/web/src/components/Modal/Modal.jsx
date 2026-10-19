import { useEffect, useEffectEvent, useId, useRef } from "react";
import styles from "./Modal.module.css";

/**
 * Accessible confirmation dialog: focus moves into it, Escape cancels, focus returns to where it was. The focus goes to
 * the element marked `data-autofocus` when there is one, such as a form's first field, or else to the first button.
 *
 * @param {{ open: boolean, title: import("react").ReactNode, onClose: () => void, children: import("react").ReactNode, actions: import("react").ReactNode }} props
 */
export function Modal({ open, title, onClose, children, actions }) {
  const dialog = useRef(null);
  const titleId = useId();
  // Callers often pass a new `onClose` on every render. Reading it here keeps the focus where it is when the page
  // behind the dialog updates, instead of moving it back to the first button (CC-254).
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const previouslyFocused = document.activeElement;
    (dialog.current?.querySelector("[data-autofocus]") ?? dialog.current?.querySelector("button"))?.focus();
    const onKey = (event) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={dialog}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <div>{children}</div>
        <div className={styles.actions}>{actions}</div>
      </div>
    </div>
  );
}
