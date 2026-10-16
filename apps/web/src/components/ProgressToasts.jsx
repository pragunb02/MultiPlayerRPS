import { useEffect } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useToast } from "./Toast/toastContext.js";

/**
 * Turns `progress:updated` pushes into toasts: XP after every match, a celebration on level-up. Quest XP has its
 * own toast (GamificationToasts), so only its level-up shows here.
 */
export function ProgressToasts() {
  const { socket } = useServices();
  const toast = useToast();

  useEffect(
    () =>
      socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, ({ source, xpGained, leveledUp, progress }) => {
        if (leveledUp) {
          toast.show(`Level up! You reached level ${progress.level}`, { tone: "success" });
        } else if (xpGained > 0 && source !== "quest") {
          toast.show(`+${xpGained} XP`, { tone: "info" });
        }
      }),
    [socket, toast],
  );

  return null;
}
