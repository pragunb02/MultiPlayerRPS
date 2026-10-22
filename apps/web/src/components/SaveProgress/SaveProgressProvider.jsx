import { useCallback, useEffect, useMemo, useState } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../../app/servicesContext.js";
import { useSession } from "../../hooks/useSession.js";
import { CATEGORIES } from "../../lib/notify/categories.js";
import { useToast } from "../Toast/toastContext.js";
import { SaveProgressContext } from "./saveProgressContext.js";
import { movedAnything, SAVED_WITHOUT_NUMBERS, savedMessage } from "./savedMessage.js";

const NOTHING = Object.freeze({ owner: undefined, value: undefined, pushed: false });

/**
 * One piece of a guest's data: loaded once, then replaced by every push. A load that answers after a push is
 * older than the push, so it is dropped.
 */
function useGuestFeed({ guestId, load, event, pick }) {
  const { socket } = useServices();
  const [state, setState] = useState(NOTHING);

  useEffect(() => {
    if (guestId === undefined) {
      return undefined;
    }
    let cancelled = false;
    load().then(
      (value) =>
        !cancelled &&
        setState((current) =>
          current.owner === guestId && current.pushed ? current : { owner: guestId, value, pushed: false },
        ),
      // Prompts are optional: without the numbers there is simply no prompt (the profile shows the error).
      () => {},
    );
    const off = socket.on(event, (payload) =>
      setState({ owner: guestId, value: pick(payload), pushed: true }),
    );
    return () => {
      cancelled = true;
      off();
    };
  }, [guestId, load, event, pick, socket]);

  return guestId !== undefined && state.owner === guestId ? state.value : undefined;
}

const pickProgress = ({ progress }) => progress;
const pickStreaks = ({ streaks }) => streaks;

/**
 * Asks guests to save their progress at the moments they have something to lose (CC-097): a win, a level-up, a
 * streak at risk — and keeps a quiet "Save progress" in the header. Holds the guest's progress and streaks (only
 * for a guest: visitors and account holders load nothing), which prompts were closed, and which rooms already
 * offered the card. All of it is memory only — a reload starts over — because nothing may be kept in web storage.
 */
export function SaveProgressProvider({ children }) {
  const { api } = useServices();
  const session = useSession();
  const toast = useToast();
  const guestId = session.identity?.kind === "guest" ? session.identity.id : undefined;
  const progress = useGuestFeed({
    guestId,
    load: api.getProgress,
    event: SOCKET_EVENTS.PROGRESS_UPDATED,
    pick: pickProgress,
  });
  const streaks = useGuestFeed({
    guestId,
    load: api.getStreaks,
    event: SOCKET_EVENTS.STREAKS_UPDATED,
    pick: pickStreaks,
  });
  const [dismissed, setDismissed] = useState(() => new Set());
  // room code → which game of the room (rematches count up) showed the card: a room offers it once.
  const [offered, setOffered] = useState(() => new Map());

  const dismiss = useCallback((prompt) => setDismissed((current) => new Set(current).add(prompt)), []);
  // Only called while the card may show in that room, i.e. for its first game or the same one again.
  const offeredInRoom = useCallback(
    ({ code, game }) => setOffered((current) => new Map(current).set(code, game)),
    [],
  );
  const confirmSaved = useCallback(
    async (carriedOver) => {
      if (!movedAnything(carriedOver)) {
        return;
      }
      try {
        toast.show(savedMessage(await api.getProgress()), {
          surface: "toast.saved",
          tone: "success",
          category: CATEGORIES.REWARD,
        });
      } catch {
        toast.show(SAVED_WITHOUT_NUMBERS, {
          surface: "toast.saved",
          tone: "success",
          category: CATEGORIES.REWARD,
        });
      }
    },
    [api, toast],
  );

  const value = useMemo(
    () => ({
      guest: guestId !== undefined,
      progress,
      streaks,
      isDismissed: (prompt) => dismissed.has(prompt),
      dismiss,
      mayOfferInRoom: ({ code, game }) => !offered.has(code) || offered.get(code) === game,
      offeredInRoom,
      confirmSaved,
    }),
    [guestId, progress, streaks, dismissed, dismiss, offered, offeredInRoom, confirmSaved],
  );

  return <SaveProgressContext.Provider value={value}>{children}</SaveProgressContext.Provider>;
}
