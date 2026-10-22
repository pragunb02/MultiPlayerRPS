import { useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * Reports where the router is (path and query), so tests can assert the URL the player sees, and hands out the
 * router's navigate so tests can press the browser's Back and Forward. It records in a layout effect, in the same
 * commit as the page it shows, so a test that has found the new page's text always reads the new address (CC-343).
 */
export function LocationProbe({ onChange, onNavigator }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  useLayoutEffect(() => onChange(`${pathname}${search}`), [pathname, search, onChange]);
  useLayoutEffect(() => onNavigator(navigate), [navigate, onNavigator]);
  return null;
}
