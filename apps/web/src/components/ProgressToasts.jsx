import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { SOCKET_EVENTS } from "@classicade/shared";
import { paths, returnPathFor } from "../app/paths.js";
import { useServices } from "../app/servicesContext.js";
import { LevelUpBurst } from "../art/effects/LevelUpBurst.jsx";
import { useSound } from "../hooks/useSound.js";
import { SOUNDS } from "../lib/sound/sounds.js";
import { computerXpMessage, isComputerGame, isUncountedMatch, notCountedMessage } from "./notCounted.js";
import { PROMPTS, useSaveProgress } from "./SaveProgress/saveProgressContext.js";
import { useToast } from "./Toast/toastContext.js";

/** How long the level-up burst stays mounted: its animation (--duration-celebrate) plus a little slack. */
export const BURST_MS = 1_500;

/**
 * Turns `progress:updated` pushes into toasts: XP after every match, and a celebration on level-up. The toast
 * says it in words, the burst shows it (and is skipped under reduced motion), and a fanfare plays (CC-103). Quest
 * XP has its own toast (GamificationToasts), so only its level-up shows here. A match that didn't count for the
 * player (CC-095) says why instead of showing XP. A game against a computer character says how much of the day's XP
 * from computer games is left (ADR-025). A guest's level-up toast also offers "Save it" (sign up and come
 * back to this page, CC-097) until they close that offer once.
 */
export function ProgressToasts() {
  const { socket } = useServices();
  const sound = useSound();
  const toast = useToast();
  const save = useSaveProgress();
  const location = useLocation();
  const [burst, setBurst] = useState(undefined);
  const nextBurst = useRef(0);

  const saveOffer = () =>
    save.guest && !save.isDismissed(PROMPTS.LEVEL_UP)
      ? {
          action: {
            label: "Save it",
            to: paths.signup(returnPathFor(location)),
            dismissLabel: "Close: save your level",
            onDismiss: () => save.dismiss(PROMPTS.LEVEL_UP),
          },
        }
      : {};

  const onProgress = useEffectEvent((update) => {
    const { source, xpGained, leveledUp, progress } = update;
    if (isUncountedMatch(update)) {
      toast.show(notCountedMessage(update.notCountedReason), { tone: "info" });
    } else if (leveledUp) {
      toast.show(`Level up! You reached level ${progress.level}`, { tone: "success", ...saveOffer() });
      setBurst({ id: ++nextBurst.current, level: progress.level });
      sound.play(SOUNDS.LEVEL_UP);
    } else if (isComputerGame(update)) {
      toast.show(computerXpMessage(update), { tone: "info" });
    } else if (xpGained > 0 && source !== "quest") {
      toast.show(`+${xpGained} XP`, { tone: "info" });
    }
  });

  useEffect(() => socket.on(SOCKET_EVENTS.PROGRESS_UPDATED, (payload) => onProgress(payload)), [socket]);

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
