import { useEffect, useMemo, useState } from "react";

const TICK_MS = 200;

/**
 * Live clock display, in server time. The server's view gives each side's remaining time as of `lastMoveAt`
 * and its own clock (`serverTime`); the client only measures how much time has passed since it received the
 * view, so a wrong local clock never shows a wrong chess clock. The server alone decides timeouts.
 *
 * @param {{ clocks: { w: number, b: number }, lastMoveAt: number, running: "w" | "b" | "", serverTime: number, now?: () => number }} input
 * @returns {{ w: number, b: number }} milliseconds left, never negative
 */
export function useChessClocks({ clocks, lastMoveAt, running, serverTime, now = Date.now }) {
  // When this view arrived, in local time; recomputed whenever a new server snapshot arrives.
  const receivedAt = useMemo(() => now(), [serverTime, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const [localNow, setLocalNow] = useState(receivedAt);

  useEffect(() => {
    if (running === "") {
      return undefined;
    }
    const timer = setInterval(() => setLocalNow(now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running, now]);

  if (running === "" || lastMoveAt === 0) {
    return clocks;
  }
  const serverNow = serverTime + Math.max(0, localNow - receivedAt);
  const elapsed = Math.max(0, serverNow - lastMoveAt);
  return { ...clocks, [running]: Math.max(0, clocks[running] - elapsed) };
}

/** 4:05, 0:59, 0:09.4 (tenths under ten seconds). */
export function formatClock(ms) {
  const totalSeconds = Math.max(0, ms) / 1000;
  if (totalSeconds < 10) {
    return `0:0${totalSeconds.toFixed(1)}`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
