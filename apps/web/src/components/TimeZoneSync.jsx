import { useTimeZoneSync } from "../hooks/useTimeZoneSync.js";

/** Draws nothing: sends the browser's time zone to the server while local days are on (CC-146). */
export function TimeZoneSync() {
  useTimeZoneSync();
  return null;
}
