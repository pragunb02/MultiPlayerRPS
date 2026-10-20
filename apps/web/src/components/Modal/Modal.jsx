import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { dialogQueue } from "./dialogQueue.js";
import styles from "./Modal.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), details > summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * Makes everything on the page's body except the dialog's backdrop `inert`, so neither a pointer, Tab nor a screen
 * reader reaches the page behind (WCAG 2.4.3). Only what this call changed is put back.
 *
 * @param {Element} backdrop
 * @returns {() => void} puts the page back as it was
 */
function inertBehind(backdrop) {
  const changed = [...document.body.children].filter(
    (element) => element !== backdrop && !element.hasAttribute("inert"),
  );
  for (const element of changed) element.setAttribute("inert", "");
  return () => {
    for (const element of changed) element.removeAttribute("inert");
  };
}

/**
 * Keeps Tab and Shift+Tab inside the dialog: from its last control Tab goes to its first, and back. The `inert` page
 * already holds the focus in a browser. This also covers the address bar, which `inert` does not.
 *
 * @param {KeyboardEvent} event
 * @param {HTMLElement} dialog
 */
function holdTab(event, dialog) {
  const controls = [...dialog.querySelectorAll(FOCUSABLE)];
  const inside = dialog.contains(document.activeElement);
  if (controls.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const [first, last] = [controls[0], controls.at(-1)];
  if (event.shiftKey && (!inside || document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * The app's one dialog (docs/design/CONTRACT.md, CC-314). Focus moves into it, Tab stays inside it, the page behind
 * is `inert`, Escape cancels, and focus returns to where it was. The focus goes to the element marked
 * `data-autofocus` when there is one, such as a form's first field, or else to the first button.
 *
 * One dialog is open at a time. A dialog opened while another is open waits, drawing nothing, until the first closes.
 *
 * @param {{ open: boolean, title: import("react").ReactNode, onClose: () => void, children: import("react").ReactNode, actions: import("react").ReactNode }} props
 */
export function Modal({ open, title, onClose, children, actions }) {
  const dialog = useRef(null);
  const titleId = useId();
  const id = useId();
  // Callers often pass a new `onClose` on every render. Reading it here keeps the focus where it is when the page
  // behind the dialog updates, instead of moving it back to the first button (CC-254).
  const close = useEffectEvent(() => onClose());
  const front = useSyncExternalStore(dialogQueue.subscribe, dialogQueue.front, dialogQueue.front);
  const shown = open && front === id;

  // Before paint, so the first dialog of a page shows in the same frame it was asked for.
  useLayoutEffect(() => {
    if (!open) return undefined;
    dialogQueue.join(id);
    return () => dialogQueue.leave(id);
  }, [open, id]);

  useEffect(() => {
    if (!shown) {
      return undefined;
    }
    const previouslyFocused = document.activeElement;
    const restorePage = inertBehind(dialog.current.parentElement);
    (
      dialog.current.querySelector("[data-autofocus]") ??
      dialog.current.querySelector("button") ??
      dialog.current
    ).focus();
    const onKey = (event) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") holdTab(event, dialog.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restorePage();
      previouslyFocused?.focus?.();
    };
  }, [shown]);

  if (!shown) {
    return null;
  }
  // Drawn on the page's body, not where it was opened. A style on an ancestor (such as the softened board after a
  // loss, a filter) would otherwise become the frame of the fixed backdrop: the dialog would be greyed with it and
  // cover only that part, leaving the buttons around it pressable (review of #113, CC-163).
  return createPortal(
    <div className={styles.backdrop} onClick={onClose} data-cc-modal-backdrop="">
      <div
        ref={dialog}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
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
