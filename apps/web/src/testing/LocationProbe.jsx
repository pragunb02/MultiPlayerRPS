import { useEffect } from "react";
import { useLocation } from "react-router";

/** Reports where the router is (path and query), so tests can assert the URL the player sees. */
export function LocationProbe({ onChange }) {
  const { pathname, search } = useLocation();
  useEffect(() => onChange(`${pathname}${search}`), [pathname, search, onChange]);
  return null;
}
