import { useEffect, useEffectEvent, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useInterruption } from "../../hooks/useInterruption.js";
import styles from "./Modal.module.css";

/**
 * Accessible confirmation dialog: focus moves into it, Escape cancels, focus returns to where it was. The focus goes to
 * the element marked `data-autofocus` when there is one, such as a form's first field, or else to the first button.
 *
 * Every dialog names its registered `surface` (CC-313) and is counted while open: closed with Escape or the backdrop
 * it was dismissed, closed by one of its own buttons it was answered.
 *
 * @param {{ open: boolean, surface: string, title: import("react").ReactNode, onClose: () => void, children: import("react").ReactNode, actions: import("react").ReactNode }} props
 */
export function Modal({ open, surface, title, onClose, children, actions }) {
  const interruption = useInterruption(surface, { open });
  const dialog = useRef(null);
  const titleId = useId();
  // Callers often pass a new `onClose` on every render. Reading it here keeps the focus where it is when the page
  // behind the dialog updates, instead of moving it back to the first button (CC-254).
  /** Escape or the backdrop: the dialog was put away without an answer (CC-313). */
  const dismiss = () => {
    interruption.dismissed();
    onClose();
  };
  const close = useEffectEvent(() => dismiss());

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
  // Drawn on the page's body, not where it was opened. A style on an ancestor (such as the softened board after a
  // loss, a filter) would otherwise become the frame of the fixed backdrop: the dialog would be greyed with it and
  // cover only that part, leaving the buttons around it pressable (review of #113, CC-163).
  return createPortal(
    <div className={styles.backdrop} onClick={dismiss} data-cc-modal-backdrop="">
      <div
        ref={dialog}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-cc-surface={surface}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <div>{children}</div>
        <div className={styles.actions}>{actions}</div>
      </div>
    </div>,
    document.body,
  );
}
