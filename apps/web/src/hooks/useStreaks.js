import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useLiveData } from "./useLiveData.js";

const replaceStreaks = (_current, { streaks }) => streaks;

/** Your win and daily streaks, updated after each counted match. `data` is `{ win, daily }`. */
export function useStreaks() {
  const { api } = useServices();
  return useLiveData({ load: api.getStreaks, event: SOCKET_EVENTS.STREAKS_UPDATED, merge: replaceStreaks });
}
