import { TELEMETRY_BUCKETS, TELEMETRY_ELEMENT_ROLES, TELEMETRY_ELEMENT_TAGS } from "@classicade/shared";

/**
 * Presses, dead clicks and rage clicks (CC-174, EVENTS.md 3.2), worked out in the browser so only the result is sent:
 * the control's stable name (`data-cc-control`, CC-170), or for an element without one its tag and role. Never its
 * text, never where on the screen.
 */
export const CLICK_RULES = Object.freeze({
  /** A press with no answer in this long is dead. */
  deadAfterMs: 1000,
  /** Three presses within this long of each other, */
  rageWithinMs: 700,
  /** and this close together, are one rage click. */
  rageWithinPx: 30,
  rageAtLeast: 3,
});

/** The parts of the page a press's answer is looked for in. Outside its own region, a change does not count. */
const REGIONS = "dialog, [role='dialog'], main, header, footer, nav, section, form";
/** Elements a person presses to type or choose, never dead: the browser answers them itself. */
const FORM_FIELDS = "input, textarea, select, option, label";
/** Elements that look pressable even without a pointer cursor (EVENTS.md 3.2: images, cards, links, buttons). */
const PRESSABLE = "a, button, [role='button'], [role='link'], img, svg";
/** Counters and timers that change on their own, which are never the answer to a press (RequestBanner's countdown). */
const TICKER = "[data-cc-ticker]";
const PRESS_KEYS = Object.freeze(["Enter", " "]);
const POINTER_LEVELS = 3;

/**
 * The tag and role of an element without a control, both from fixed lists, such as `img` or `div:button`.
 *
 * @param {Element} element
 * @returns {string}
 */
export function elementNameOf(element) {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute("role");
  const name = TELEMETRY_ELEMENT_TAGS.includes(tag) ? tag : "other";
  if (role === null) return name;
  return `${name}:${TELEMETRY_ELEMENT_ROLES.includes(role) ? role : "other"}`;
}

/**
 * Whether an element looks pressable: a pointer cursor on it or close above it, or a kind that always looks so.
 *
 * @param {Element} element
 * @param {Pick<Window, "getComputedStyle">} view
 */
function looksPressable(element, view) {
  if (element.closest(FORM_FIELDS) !== null) return false;
  if (element.closest(PRESSABLE) !== null) return true;
  let node = element;
  for (let level = 0; node !== null && level < POINTER_LEVELS; level += 1) {
    if (view.getComputedStyle(node).cursor === "pointer") return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Watches every press on the page and counts it.
 *
 * @param {{
 *   document: Document,
 *   view: Pick<Window, "getComputedStyle" | "location">,
 *   track: (name: string, fields: Record<string, string | number | boolean>) => void,
 *   requestsSent: () => { http: number, socket: number },
 *   MutationObserver: typeof MutationObserver,
 *   now: () => number,
 *   setTimer: (run: () => void, ms: number) => unknown,
 *   clearTimer: (timer: unknown) => void,
 *   surfaceOf?: (element: Element) => string | undefined,   the interruption a press landed in (CC-313's slot)
 * }} deps
 * @returns {{ presses: () => number, stop: () => void }} `presses` is how many presses this page had
 */
export function watchClicks({
  document,
  view,
  track,
  requestsSent,
  MutationObserver,
  now,
  setTimer,
  clearTimer,
  surfaceOf = () => undefined,
}) {
  let presses = 0;
  /** @type {Array<{ at: number, x: number, y: number }>} */
  let recent = [];
  let rage = { timer: undefined, count: 0, fields: {} };
  const watching = new Set();

  const totalRequests = () => {
    const { http, socket } = requestsSent();
    return http + socket;
  };
  const withSurface = (fields, element) => {
    const surface = surfaceOf(element);
    return surface === undefined ? fields : { ...fields, surface };
  };

  /** Looks for an answer to a press for a moment: a change in its region, a request or a new address. */
  function watchForAnswer(element, fields) {
    const region = element.closest(REGIONS) ?? document.body;
    const before = { requests: totalRequests(), href: view.location.href };
    let answered = false;
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !isTicker(record.target))) answered = true;
    });
    observer.observe(region, { subtree: true, childList: true, attributes: true, characterData: true });
    const watch = { observer, timer: undefined };
    watching.add(watch);
    watch.timer = setTimer(() => {
      // Changes not yet handed to the callback count too, so they are taken before the observer stops.
      const late = observer.takeRecords().some((record) => !isTicker(record.target));
      observer.disconnect();
      watching.delete(watch);
      const changed =
        answered || late || totalRequests() !== before.requests || view.location.href !== before.href;
      if (!changed) track("dead_clicked", fields);
    }, CLICK_RULES.deadAfterMs);
  }

  function isTicker(node) {
    const element = node.nodeType === 1 ? /** @type {Element} */ (node) : node.parentElement;
    return Boolean(element?.closest(TICKER));
  }

  function endRage() {
    if (rage.count >= CLICK_RULES.rageAtLeast) {
      const bucket = TELEMETRY_BUCKETS.RAGE_PRESSES;
      const presses = bucket[Math.min(rage.count, 6) - CLICK_RULES.rageAtLeast];
      track("rage_clicked", { ...rage.fields, presses });
    }
    rage = { timer: undefined, count: 0, fields: {} };
  }

  /** Three or more pointer presses close in time and place are one rage click, sent when they stop. */
  function noteForRage(at, x, y, fields) {
    recent = recent.filter(
      (press) =>
        at - press.at <= CLICK_RULES.rageWithinMs &&
        Math.hypot(press.x - x, press.y - y) <= CLICK_RULES.rageWithinPx,
    );
    recent.push({ at, x, y });
    if (recent.length < CLICK_RULES.rageAtLeast) return;
    if (rage.timer !== undefined) clearTimer(rage.timer);
    rage = { count: recent.length, fields, timer: setTimer(endRage, CLICK_RULES.rageWithinMs) };
  }

  /** @param {Element} element @param {{ x: number, y: number } | undefined} point */
  function pressed(element, point) {
    presses += 1;
    const control = element.closest("[data-cc-control]");
    let fields;
    if (control !== null) {
      const name = control.getAttribute("data-cc-control") ?? "";
      const blocked = control.getAttribute("aria-disabled") === "true";
      track("control_pressed", withSurface({ control: name, has_reason: blocked }, element));
      fields = withSurface({ control: name }, element);
      // A blocked button shows why it cannot act, which is its answer.
      if (!blocked) watchForAnswer(control, fields);
    } else if (looksPressable(element, view)) {
      fields = withSurface({ element: elementNameOf(element) }, element);
      // A pressable-looking element without a control is a dead click by definition (EVENTS.md 3.2).
      setTimer(() => track("dead_clicked", fields), CLICK_RULES.deadAfterMs);
    }
    if (point !== undefined && fields !== undefined) {
      noteForRage(now(), point.x, point.y, fields);
    }
  }

  const onPointer = (event) => {
    if (event.target instanceof Element && event.button === 0) {
      pressed(event.target, { x: event.clientX, y: event.clientY });
    }
  };
  const onKey = (event) => {
    if (event.target instanceof Element && PRESS_KEYS.includes(event.key) && !event.repeat) {
      if (event.target.closest(FORM_FIELDS) === null) pressed(event.target, undefined);
    }
  };

  document.addEventListener("pointerup", onPointer, true);
  document.addEventListener("keydown", onKey, true);

  return Object.freeze({
    presses: () => presses,
    stop() {
      document.removeEventListener("pointerup", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
      watching.forEach(({ observer, timer }) => {
        observer.disconnect();
        clearTimer(timer);
      });
      watching.clear();
      if (rage.timer !== undefined) clearTimer(rage.timer);
    },
  });
}
