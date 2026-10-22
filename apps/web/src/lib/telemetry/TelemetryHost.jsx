import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { APP_BUILD } from "../../app/build.js";
import { ServicesContext } from "../../app/servicesContext.js";
import { WAITED_CLASS } from "../../app/wakingUp.js";
import { FLAG_STATES, useFlagState } from "../../hooks/useFlag.js";
import { whenIdle } from "../idle.js";
import { NO_TELEMETRY } from "./facade.js";
import { routeOf } from "./routeOf.js";

/** Loads the client in its own file, so the page's first paint never waits for it (CC-174, AC-9). */
const loadClient = () => import("./index.js");

/**
 * Usage counts for the whole app (CC-174, ADR-034), behind the `telemetry_client` flag (CC-312). The first page's stub
 * (TelemetryStub.jsx) loads it once the browser is idle (CC-322). It loads the client once the flag is on and nothing
 * has switched counts off. With the flag off, or the switch, GPC or DNT, nothing is held and nothing is sent.
 * Renders nothing.
 *
 * @param {{ load?: typeof loadClient }} props  `load` is for tests
 */
export function TelemetryHost({ load = loadClient }) {
  const services = useContext(ServicesContext);
  const telemetry = services?.telemetry ?? NO_TELEMETRY;
  const flag = useFlagState("telemetry_client");
  const [switches, setSwitches] = useState(0);
  // Started once, and kept while the flag is asked again for a new session.
  const running = useRef({ started: undefined, loading: false, retries: 1 });
  // The flag's answer now, read when the client's file arrives: it may have turned off while the file was on its way.
  const flagNow = useRef(flag);
  useLayoutEffect(() => {
    flagNow.current = flag;
  }, [flag]);
  useEffect(() => telemetry.onSwitched(() => setSwitches((count) => count + 1)), [telemetry]);

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
    // The client's file never reloads the tab, and a failed download is tried once more (review of #161).
    const begin = () =>
      telemetry
        .quietly(load)
        .then(({ startTelemetry }) => {
          current.loading = false;
          if (current.started !== undefined || telemetry.isOff() || flagNow.current !== FLAG_STATES.ON)
            return;
          current.started = startTelemetry({
            window,
            facade: telemetry,
            isOff: telemetry.isOff,
            build: APP_BUILD,
            strict: !import.meta.env.PROD,
            wasWaking: document.documentElement.classList.contains(WAITED_CLASS),
            routeOf,
            onAccepted: () => services.api.sendFlagSuccess("telemetry_client").catch(() => undefined),
          });
        })
        .catch(() => {
          current.loading = false;
          if (current.retries === 0) return;
          current.retries -= 1;
          current.loading = true;
          whenIdle({ window, run: begin });
        });
    // After the first paint, when the browser is idle.
    whenIdle({ window, run: begin });
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
