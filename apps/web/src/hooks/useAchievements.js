import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useLiveData } from "./useLiveData.js";

// The push carries only what was just unlocked.
const mergeUnlocks = (current, { achievements }) =>
  current.map((item) => achievements.find((unlocked) => unlocked.id === item.id) ?? item);

/** Every achievement with your progress, in catalog order; unlocks arrive live. `data` is the list. */
export function useAchievements() {
  const { api } = useServices();
  return useLiveData({
    load: api.getAchievements,
    event: SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED,
    merge: mergeUnlocks,
  });
}
