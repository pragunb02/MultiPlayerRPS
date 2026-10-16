import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

/**
 * Reports where the router is (path and query), so tests can assert the URL the player sees, and hands out the
 * router's navigate so tests can press the browser's Back and Forward.
 */
export function LocationProbe({ onChange, onNavigator }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  useEffect(() => onChange(`${pathname}${search}`), [pathname, search, onChange]);
  useEffect(() => onNavigator(navigate), [navigate, onNavigator]);
  return null;
}
