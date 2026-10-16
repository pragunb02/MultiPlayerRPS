import { createContext, useContext } from "react";

/** Short, non-blocking notifications ("+30 XP", "Link copied"). Provided by <ToastProvider>. */
export const ToastContext = createContext(null);

/** @returns {{ show: (message: string, options?: { tone?: "info" | "success" | "danger" }) => void }} */
export function useToast() {
  const toast = useContext(ToastContext);
  if (toast === null) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return toast;
}
