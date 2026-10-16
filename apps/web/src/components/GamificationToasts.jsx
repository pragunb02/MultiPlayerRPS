import { useEffect } from "react";
import { SOCKET_EVENTS } from "@classicade/shared";
import { useServices } from "../app/servicesContext.js";
import { useToast } from "./Toast/toastContext.js";

const SWEEP_SUFFIX = ":sweep";

/**
 * Celebrates what the server pushes (CC-054, CC-089): "Achievement unlocked: Hat Trick" for each new unlock, and
 * "Quest complete! +40 XP" when a quest's bonus is awarded (once each — the server sends quest XP exactly once).
 */
export function GamificationToasts() {
  const { socket } = useServices();
  const toast = useToast();

  useEffect(() => {
    const offUnlocks = socket.on(SOCKET_EVENTS.ACHIEVEMENTS_UNLOCKED, ({ achievements }) =>
      achievements.forEach((achievement) =>
        toast.show(`Achievement unlocked: ${achievement.name}`, { tone: "success" }),
      ),
    );
    const offQuestXp = socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, ({ source, key, xpGained }) => {
      if (source !== "quest") return;
      toast.show(
        key.endsWith(SWEEP_SUFFIX) ? `Daily sweep! +${xpGained} XP` : `Quest complete! +${xpGained} XP`,
        { tone: "success" },
      );
    });
    return () => {
      offUnlocks();
      offQuestXp();
    };
  }, [socket, toast]);

  return null;
}
