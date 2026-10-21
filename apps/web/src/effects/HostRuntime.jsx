import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { paths } from "../app/paths.js";
import { useServices } from "../app/servicesContext.js";
import { useInGame } from "../components/SiteRequests/inGameContext.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import { useSession } from "../hooks/useSession.js";
import { attachHost, currentPreview, showTheme, subscribe, whenIdle } from "./channel.js";
import { activeTheme, canPlay, GATES, indiaDay, inWindow, isLowEnd, msToIndiaMidnight } from "./gates.js";
import { EFFECTS, MAX_EFFECT_MS } from "./registry.js";
import styles from "./EffectHost.module.css";

/** A celebration that would start more than this late, behind another one, is dropped (ADR-012). */
const LATE_MS = 2000;
const NO_FLAGS = Object.freeze({});
/** What happened once in this visit, in memory only: a theme's entrance burst, and its success. */
const once = new Set();

/**
 * The effect host itself (ADR-075, CC-328), which `EffectHost` loads at idle. It owns the canvas, which exists
 * only while an effect plays, and the queue: one standout effect at a time, a second celebration waiting behind
 * the first or dropped if it would start over 2 s late, and nothing under reduced motion, in a hidden tab or during
 * a game. It also turns on the event theme: one flags question for the themes whose window holds today (India),
 * asked again at India midnight, `data-event-theme` on `<html>`, the theme's chunk at idle (never with save-data)
 * with its colours and greeting, its entrance burst once per visit on the home page, and its success when a game
 * starts in the same visit.
 *
 * @param {{ effects?: typeof EFFECTS, now?: () => number }} props  the registry and the clock; tests give their own
 */
export function HostRuntime({ effects = EFFECTS, now = Date.now }) {
  const { api } = useServices();
  const who = useSession().identity?.id ?? "";
  const reducedMotion = useReducedMotion();
  const inGame = useInGame();
  const home = useLocation().pathname === paths.home();
  const preview = useSyncExternalStore(subscribe, currentPreview);
  const [today, setToday] = useState(() => indiaDay(now()));
  const [answer, setAnswer] = useState({ who: undefined, flags: NO_FLAGS });
  const [loaded, setLoaded] = useState();
  const [job, setJob] = useState();
  const canvas = useRef(null);
  const host = useRef({ queue: [], job: undefined, facts: {}, end: undefined });

  const flags = answer.who === who ? answer.flags : NO_FLAGS;
  const theme = activeTheme({ entries: effects, today, flags, preview });
  const wanted = effects
    .filter((entry) => entry.flag && entry.window && inWindow(entry, today))
    .map((entry) => entry.flag)
    .join();

  useEffect(() => {
    host.current.facts = { flags, reducedMotion, inGame };
  });

  // The queue: `play` from anywhere lands here.
  useEffect(() => {
    const machine = host.current;
    const gate = (entry) =>
      canPlay({
        entry,
        now: now(),
        ...machine.facts,
        device: { lowEnd: isLowEnd(navigator) },
        hidden: document.hidden,
        busy: machine.job !== undefined || machine.queue.length > 0,
      });
    machine.next = () => {
      while (machine.job === undefined && machine.queue.length > 0) {
        const item = machine.queue.shift();
        const answer = now() - item.at > LATE_MS ? { ok: false } : gate(item.entry);
        if (answer.ok) {
          machine.job = { ...item, particles: answer.particles };
          setJob(machine.job);
        } else {
          item.resolve(false);
        }
      }
    };
    machine.request = (entry, options) =>
      new Promise((resolve) => {
        const answer = gate(entry);
        if (answer.ok || (answer.gate === GATES.BUSY && entry.kind === "celebration")) {
          machine.queue.push({ entry, options, resolve, at: now() });
          machine.next();
        } else {
          resolve(false);
        }
      });
    machine.stopAll = () => {
      machine.queue.splice(0).forEach((item) => item.resolve(false));
      machine.end?.(false);
    };
    const hide = () => document.hidden && machine.stopAll();
    document.addEventListener("visibilitychange", hide);
    const detach = attachHost((name, options) =>
      machine.request(
        effects.find((entry) => entry.name === name),
        options,
      ),
    );
    return () => {
      detach();
      document.removeEventListener("visibilitychange", hide);
      machine.stopAll();
    };
  }, [effects, now]);

  // The effect on the canvas now. It stops at its end, when it is cut short, and at the latest after the cap.
  useEffect(() => {
    if (job === undefined) return undefined;
    const machine = host.current;
    let running;
    let live = true;
    const end = (played) => {
      if (!live) return;
      live = false;
      clearTimeout(cap);
      running?.stop();
      machine.job = machine.end = undefined;
      job.resolve(played);
      setJob(undefined);
      machine.next();
    };
    const cap = setTimeout(() => end(true), MAX_EFFECT_MS + 500);
    machine.end = end;
    job.entry.load().then(
      (module) => {
        if (!live) return;
        running = module.start(canvas.current, {
          origin: job.options.origin,
          particles: job.particles,
          durationMs: job.entry.durationMs,
        });
        running.done.then(() => end(true));
      },
      // A failed load is silent: the effect is decoration (ADR-075 point 5).
      () => end(false),
    );
    return () => end(false);
  }, [job]);

  // A game starting or reduced motion turning on stops what plays.
  useEffect(() => {
    if (inGame || reducedMotion) host.current.stopAll();
  }, [inGame, reducedMotion]);

  // A window opens and closes at India midnight.
  useEffect(() => {
    const id = setTimeout(() => setToday(indiaDay(now())), msToIndiaMidnight(now()) + 1000);
    return () => clearTimeout(id);
  }, [today, now]);

  // One question for the flags of the themes that could be on today; none outside every window.
  useEffect(() => {
    if (wanted === "") return undefined;
    let live = true;
    api.getFlags(wanted.split(",")).then(
      (answered) => live && setAnswer({ who, flags: answered }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api, wanted, who]);

  // The theme: its attribute at once, its colours and greeting when its chunk arrives at idle. With save-data the
  // chunk is never fetched, so the page keeps its usual look.
  useEffect(() => {
    if (theme === undefined) return undefined;
    let live = true;
    const root = document.documentElement;
    root.dataset.eventTheme = theme.name;
    const cancel = navigator.connection?.saveData
      ? undefined
      : whenIdle(() =>
          theme.load().then(
            (module) => {
              if (!live) return;
              showTheme({ name: theme.name, greeting: module.greeting });
              setLoaded(theme.name);
            },
            () => {},
          ),
        );
    return () => {
      live = false;
      cancel?.();
      delete root.dataset.eventTheme;
      showTheme(undefined);
    };
  }, [theme]);

  // The theme's entrance burst: once per visit, on the home page, at idle, never over a celebration.
  useEffect(() => {
    if (!home || theme === undefined || loaded !== theme.name || once.has(theme.name)) return undefined;
    const entry = theme.name === preview ? { ...theme, flag: null, window: undefined } : theme;
    return whenIdle(() => host.current.request(entry, {}).then((played) => played && once.add(theme.name)));
  }, [home, theme, loaded, preview]);

  // Its success: a game started in a visit that had the theme on (not a preview).
  useEffect(() => {
    const key = `success:${theme?.name}`;
    if (!inGame || theme === undefined || theme.name === preview || once.has(key)) return;
    once.add(key);
    api.sendFlagSuccess(theme.flag).catch(() => {});
  }, [api, inGame, theme, preview]);

  return job === undefined ? null : (
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" data-effect={job.entry.name} />
  );
}
