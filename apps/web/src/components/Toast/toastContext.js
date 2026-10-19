import { createContext, useContext, useLayoutEffect } from "react";

/** Short, non-blocking notifications ("+30 XP", "Link copied"). Provided by <ToastProvider>. */
export const ToastContext = createContext(null);

/**
 * @typedef {{ label: string, to: string, dismissLabel: string, onDismiss: () => void }} ToastAction
 *   a link shown in the toast, and a close button named `dismissLabel` that calls `onDismiss`
 * @returns {{
 *   show: (message: string, options?: { tone?: "info" | "success" | "danger", art?: import("react").ReactNode, action?: ToastAction, category?: string, onShow?: () => void }) => number,
 *   dismiss: (id: number) => void,
 *   hold: (category: string) => () => void,
 * }} `show` returns the toast's id, and `dismiss` takes a toast away before its time is up. `category` is a
 *   notification category (CATEGORIES, CC-208), "system" when not given. `onShow` runs when the toast really
 *   shows, which is later when it had to wait (CC-163). `hold` keeps toasts of lower categories waiting until the
 *   function it returns is called
 */
export function useToast() {
  const toast = useContext(ToastContext);
  if (toast === null) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return toast;
}

/**
 * While `active`, toasts of categories below `category` wait (CC-208). The request banner holds the request
 * category, so rewards wait until the question is answered. The hold starts in a layout effect, in the same step that
 * draws the question. A plain effect can run a moment later, and a reward arriving in that moment would cover the
 * question (CC-288).
 *
 * @param {string} category  a CATEGORIES value
 * @param {boolean} active
 */
export function useHold(category, active) {
  const { hold } = useToast();
  useLayoutEffect(() => (active ? hold(category) : undefined), [hold, category, active]);
}
