import { useContext, useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { ServicesContext } from "../../app/servicesContext.js";
import { useFlag } from "../../hooks/useFlag.js";
import { NO_INTERRUPTIONS } from "./interruptions.js";
import { routeOf } from "./routeOf.js";
import { countWords, wordBuckets } from "./textMeasure.js";

/** A route's words are counted this long after it settles (CC-313 section 3). */
export const TEXT_AFTER_MS = 1000;

const LINK_ENTRIES = Object.freeze(["room_link", "shared_link"]);

/** The funnel steps a screen is (CC-313 section 4): the game's page, the sign-up form, a challenge's link. */
function stepsOfRoute(route) {
  if (/^\/games\/[a-z-]+$/.test(route) && route !== "/games/:slug") return [["visit_to_play", "game_opened"]];
  if (route === "/signup") return [["sign_up", "form_viewed"]];
  if (route === "/challenge/:id") return [["challenge", "challenge_opened"]];
  return [];
}

/**
 * Interruption and friction counts for the whole app (CC-313), behind the `interruption_counts` flag (CC-312). It
 * turns the tracker on and off with the flag, counts the words of each screen a second after it settles (buckets
 * only, never a word), reaches the funnel steps that are screens, and ends every showing surface when the page is
 * left. Renders nothing.
 */
export function InterruptionHost() {
  const services = useContext(ServicesContext);
  const tracker = services?.interruptions ?? NO_INTERRUPTIONS;
  const telemetry = services?.telemetry;
  const on = useFlag("interruption_counts");
  const { pathname } = useLocation();
  const landed = useRef(false);

  useEffect(() => tracker.setEnabled(on), [tracker, on]);
  useEffect(
    () =>
      tracker.onFirstEnded(() => services?.api.sendFlagSuccess("interruption_counts").catch(() => undefined)),
    [tracker, services],
  );

  useEffect(() => {
    if (!on) return undefined;
    const route = routeOf(pathname);
    if (!landed.current) {
      landed.current = true;
      tracker.reach("visit_to_play", "landed");
      if (LINK_ENTRIES.includes(telemetry?.landing.entry)) tracker.reach("link_to_seat", "link_opened");
    }
    stepsOfRoute(route).forEach(([funnel, step]) => tracker.reach(funnel, step));
    const timer = window.setTimeout(() => {
      const main = document.querySelector("main");
      if (main === null) return;
      telemetry?.track("screen_text_measured", wordBuckets(countWords(main, { view: window, document })));
    }, TEXT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [on, pathname, tracker, telemetry]);

  useEffect(() => {
    /** @param {PageTransitionEvent} event */
    const onPageHide = (event) => {
      if (!event.persisted) tracker.pageLeft();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [tracker]);

  return null;
}
