import { createContext, useContext } from "react";

/** Short, non-blocking notifications ("+30 XP", "Link copied"). Provided by <ToastProvider>. */
export const ToastContext = createContext(null);

/**
 * @typedef {{ label: string, to: string, dismissLabel: string, onDismiss: () => void }} ToastAction
 *   a link shown in the toast, and a close button named `dismissLabel` that calls `onDismiss`
 * @returns {{
 *   show: (message: string, options?: { tone?: "info" | "success" | "danger", art?: import("react").ReactNode, action?: ToastAction }) => number,
 *   dismiss: (id: number) => void,
 * }} `show` returns the toast's id, and `dismiss` takes a toast away before its time is up
 */
export function useToast() {
  const toast = useContext(ToastContext);
  if (toast === null) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return toast;
}
