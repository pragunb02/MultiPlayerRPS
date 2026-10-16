import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useLiveData } from "./useLiveData.js";

const replaceQuests = (_current, { quests }) => quests;

/** Today's quests, updated as you play. `data` is `{ day, resetsAt, items, sweep }`; `retry()` reloads. */
export function useQuests() {
  const { api } = useServices();
  return useLiveData({ load: api.getQuests, event: SOCKET_EVENTS.QUESTS_UPDATED, merge: replaceQuests });
}
