import { useEffect, useState } from "react";
import { useConnection } from "../../hooks/useConnection.js";
import { useSound } from "../../hooks/useSound.js";
import { SOUNDS } from "../../lib/sound/sounds.js";
import styles from "./ConnectionBanner.module.css";

/** A dropped connection that comes back within this time is not worth a banner (CC-158). */
export const RECONNECTING_AFTER_MS = 1_000;

/**
 * The player's own connection (CC-158), under the site header on every page. When the connection has been gone
 * for a second, "Connection lost. Reconnecting… Your game is kept." shows and is read out at once, while the room's
 * controls say "Reconnecting. Your move can wait." if pressed (CC-350). When the server said it is restarting for a deploy, the banner says the game is safe instead, at once,
 * because rooms are kept and rejoined by themselves (CC-101). It goes away the moment the connection is back.
 */
export function ConnectionBanner() {
  const { lost, restarting, drops } = useConnection();
  const sound = useSound();
  // The drop that has lasted a second already, so a new drop waits its own second.
  const [lateDrop, setLateDrop] = useState(-1);

  useEffect(() => {
    if (!lost) return undefined;
    const timer = setTimeout(() => setLateDrop(drops), RECONNECTING_AFTER_MS);
    return () => clearTimeout(timer);
  }, [lost, drops]);

  const shown = restarting || (lost && lateDrop === drops);
  useEffect(() => {
    if (shown) sound.play(SOUNDS.CONNECTION);
  }, [shown, sound]);

  if (!shown) {
    return null;
  }
  return (
    <div className={styles.banner} role="alert">
      <span className={styles.spinner} aria-hidden="true" />
      {restarting
        ? "Server restarting, your game is safe"
        : "Connection lost. Reconnecting… Your game is kept."}
    </div>
  );
}
