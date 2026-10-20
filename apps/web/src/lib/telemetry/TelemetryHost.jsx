import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { TELEMETRY_PLAYER_KINDS } from "@classicade/shared";
import { APP_BUILD } from "../../app/build.js";
import { ServicesContext } from "../../app/servicesContext.js";
import { WAITED_CLASS } from "../../app/wakingUp.js";
import { FLAG_STATES, useFlagState } from "../../hooks/useFlag.js";
import { useSession } from "../../hooks/useSession.js";
import { NO_TELEMETRY } from "./facade.js";
import { routeOf } from "./routeOf.js";

/** The client loads after the first paint, when the browser is idle, or after this long at most. */
const LOAD_WITHIN_MS = 2000;

const kindOf = (identity) => {
  if (identity === undefined) return TELEMETRY_PLAYER_KINDS.VISITOR;
  return identity.kind === "user" ? TELEMETRY_PLAYER_KINDS.ACCOUNT : TELEMETRY_PLAYER_KINDS.GUEST;
};

/** Loads the client in its own file, so the page's first paint never waits for it (CC-174, AC-9). */
const loadClient = () => import("./index.js");

/**
 * Usage counts for the whole app (CC-174, ADR-034), behind the `telemetry_client` flag (CC-312). It tells the facade
 * which screen and which kind of player each event belongs to, counts each page view once it settles on its
 * canonical address, and loads the client once the flag is on and nothing has switched counts off. With the flag
 * off, or the switch, GPC or DNT, nothing is held and nothing is sent. Renders nothing.
 *
 * @param {{ load?: typeof loadClient }} props  `load` is for tests
 */
export function TelemetryHost({ load = loadClient }) {
  const services = useContext(ServicesContext);
  const telemetry = services?.telemetry ?? NO_TELEMETRY;
  const location = useLocation();
  const session = useSession();
  const flag = useFlagState("telemetry_client");
  const [switches, setSwitches] = useState(0);
  const landed = useRef(false);
  // Started once, and kept while the flag is asked again for a new session.
  const running = useRef({ started: undefined, loading: false });
  const route = routeOf(location.pathname);
  const playerKind = kindOf(session.identity);

  useLayoutEffect(() => {
    telemetry.setContext({ route, playerKind });
  }, [telemetry, route, playerKind]);

  useEffect(() => telemetry.onSwitched(() => setSwitches((count) => count + 1)), [telemetry]);

  // A page view counts once the address settled: a page that replaces its address at once is counted at the new one.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const isLanding = !landed.current;
      landed.current = true;
      const { entry, via } = telemetry.landing;
      telemetry.track("page_viewed", {
        is_landing: isLanding,
        ...(isLanding && { entry }),
        ...(isLanding && via !== "" && { via }),
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [telemetry, location.pathname]);

  useEffect(() => {
    const current = running.current;
    if (flag === FLAG_STATES.UNKNOWN) return;
    if (flag === FLAG_STATES.OFF || telemetry.isOff()) {
      current.started?.stop();
      current.started = undefined;
      telemetry.detach();
      return;
    }
    if (current.started !== undefined || current.loading) return;
    current.loading = true;
    const begin = () =>
      load().then(({ startTelemetry }) => {
        current.loading = false;
        if (current.started !== undefined || telemetry.isOff()) return;
        current.started = startTelemetry({
          window,
          facade: telemetry,
          isOff: telemetry.isOff,
          build: APP_BUILD,
          strict: !import.meta.env.PROD,
          wasWaking: document.documentElement.classList.contains(WAITED_CLASS),
          onAccepted: () => services.api.sendFlagSuccess("telemetry_client").catch(() => undefined),
          ...(services.interruptions && { surfaceOf: services.interruptions.surfaceOf }),
        });
      });
    if (window.requestIdleCallback === undefined) window.setTimeout(begin, 0);
    else window.requestIdleCallback(begin, { timeout: LOAD_WITHIN_MS });
  }, [flag, telemetry, load, services, switches]);

  useEffect(() => {
    const current = running.current;
    return () => {
      current.started?.stop();
      current.started = undefined;
    };
  }, []);

  return null;
}
