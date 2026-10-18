import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]";

/**
 * A disclosure menu: a button that shows and hides a panel (CC-259). Opening it moves the keyboard focus to the
 * panel's first control. Escape closes it and puts the focus back on the button. A click outside it, or going to
 * another page, closes it too. Moving the focus out does not: closing then would move the page under a tap that
 * has started but not yet ended.
 *
 * A new page starts with the menu closed. A change that stays on the same page, such as logging out on the home
 * page, leaves it open, so the player sees what changed in it.
 *
 * @returns {{
 *   open: boolean,
 *   toggle: () => void,
 *   buttonRef: import("react").RefObject<HTMLButtonElement | null>,
 *   panelRef: import("react").RefObject<HTMLElement | null>,
 * }}
 */
export function useDisclosureMenu() {
  const { pathname } = useLocation();
  const [state, setState] = useState({ open: false, pathname });
  // Another page: close while rendering it, so the new page never shows the menu open for a moment.
  if (state.pathname !== pathname) {
    setState({ open: false, pathname });
  }
  const open = state.open && state.pathname === pathname;
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  const close = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  const toggle = useCallback(() => setState((current) => ({ ...current, open: !current.open })), []);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current.querySelector(FOCUSABLE)?.focus();
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      close();
      buttonRef.current.focus();
    };
    // On click, not on press: the target gets the whole click first, and only then does the menu close.
    const onClickOutside = (event) => {
      if (panelRef.current.contains(event.target) || buttonRef.current.contains(event.target)) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClickOutside);
    };
  }, [open, close]);

  return { open, toggle, buttonRef, panelRef };
}
