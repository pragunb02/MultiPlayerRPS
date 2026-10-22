import { useContext, useEffect, useMemo, useRef } from "react";
import { surfaceNamed } from "@classicade/shared";
import { ServicesContext } from "../app/servicesContext.js";
import { NO_INTERRUPTIONS } from "../lib/telemetry/interruptions.js";

/**
 * Counts one surface while it shows (CC-313): from when `open` is true until it is false or the component goes. Every
 * toast, banner, dialog, card, line, request and screen goes through this or through the toast and dialog components,
 * which call it themselves. Mark how it ended before it closes: `acted()` when its own action was pressed,
 * `dismissed()` when it was closed. Without a mark a dialog counts as answered and anything else as gone by itself.
 *
 * Write the surface out in full as a quoted string, so the test that reads the source can find it.
 *
 * @param {string} surface  a surface in packages/shared/src/telemetry/surfaces.js
 * @param {{ open?: boolean, trigger?: "player" | "system" }} [options]  `trigger` overrides the registry's `opens`
 * @returns {{ acted: () => void, dismissed: () => void }}
 * @throws {RangeError} for an unregistered surface
 */
export function useInterruption(surface, { open = true, trigger } = {}) {
  surfaceNamed(surface);
  const tracker = useContext(ServicesContext)?.interruptions ?? NO_INTERRUPTIONS;
  const handle = useRef(undefined);

  useEffect(() => {
    if (!open) return undefined;
    const shown = tracker.open(surface, trigger === undefined ? {} : { trigger });
    handle.current = shown;
    return () => {
      shown.end();
      handle.current = undefined;
    };
  }, [tracker, surface, open, trigger]);

  return useMemo(
    () => ({
      acted: () => handle.current?.acted(),
      dismissed: () => handle.current?.dismissed(),
    }),
    [],
  );
}
