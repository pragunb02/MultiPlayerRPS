import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { LevelUpBurst } from "../art/effects/LevelUpBurst.jsx";
import { useToast } from "./Toast/toastContext.js";

/** How long the level-up burst stays mounted: its animation (--duration-celebrate) plus a little slack. */
export const BURST_MS = 1_500;

/**
 * Turns `progress:updated` pushes into toasts: XP after every match, a celebration on level-up — the toast says
 * it in words, the burst shows it (and is skipped under reduced motion). Quest XP has its own toast
 * (GamificationToasts), so only its level-up shows here.
 */
export function ProgressToasts() {
  const { socket } = useServices();
  const toast = useToast();
  const [burst, setBurst] = useState(undefined);
  const nextBurst = useRef(0);

  useEffect(
    () =>
      socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, ({ source, xpGained, leveledUp, progress }) => {
        if (leveledUp) {
          toast.show(`Level up! You reached level ${progress.level}`, { tone: "success" });
          setBurst({ id: ++nextBurst.current, level: progress.level });
        } else if (xpGained > 0 && source !== "quest") {
          toast.show(`+${xpGained} XP`, { tone: "info" });
        }
      }),
    [socket, toast],
  );

  useEffect(() => {
    if (burst === undefined) {
      return undefined;
    }
    const timer = setTimeout(() => setBurst(undefined), BURST_MS);
    return () => clearTimeout(timer);
  }, [burst]);

  return burst === undefined
    ? null
    : createPortal(<LevelUpBurst key={burst.id} level={burst.level} />, document.body);
}
