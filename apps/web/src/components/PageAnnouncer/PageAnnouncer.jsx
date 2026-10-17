import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

/** How long a new page may take to show its heading (a room loads over the socket) before `main` is used. */
const HEADING_WAIT_MS = 10_000;

/**
 * Calls `onReady` with the page's main heading once it is on screen, or with `main` itself when no heading has
 * come after `waitMs`. Answers a function that stops waiting.
 */
function whenHeading({ main, waitMs, onReady }) {
  const now = main.querySelector("h1");
  if (now !== null) {
    onReady(now);
    return () => {};
  }
  const observer = new MutationObserver(() => {
    const heading = main.querySelector("h1");
    if (heading !== null) {
      stop();
      onReady(heading);
    }
  });
  const timer = setTimeout(() => {
    stop();
    onReady(main);
  }, waitMs);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
  }
  observer.observe(main, { childList: true, subtree: true });
  return stop;
}

/**
 * Focuses an element that is not normally focusable. The temporary tabindex goes again when focus leaves, so a
 * click on the heading later does not leave it focused. With `keepScroll` the page does not scroll to it.
 */
function focusTarget(element, keepScroll) {
  if (!element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
    element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
  }
  element.focus({ preventScroll: keepScroll });
}

/**
 * Tells keyboard and screen reader users that the page changed, which a page drawn in the browser does not do by
 * itself. On a new page, focus moves to its main heading and the new title is read out politely. It never takes
 * focus away from a player:
 *
 * 1. Only a new path counts. A room that updates, a rematch and the skip link keep the path.
 * 2. The first page and redirects before the player pressed anything (an old URL replaced by the canonical one)
 *    leave focus alone, so the skip link stays the first Tab stop on load.
 * 3. If the pressed control is still on screen in `main` (a leaderboard tab), the page is only announced.
 * 4. A heading that comes later is waited for, and focus moves only if it is still where the press left it.
 *
 * Research and sources are in docs/tickets/CC-183.md.
 *
 * @param {{ waitMs?: number }} props  `waitMs`: how long to wait for the heading, for tests
 */
export function PageAnnouncer({ waitMs = HEADING_WAIT_MS }) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const region = useRef(null);
  const shown = useRef(pathname);
  const pressed = useRef(false);

  useEffect(() => {
    const mark = () => {
      pressed.current = true;
    };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    return () => {
      document.removeEventListener("pointerdown", mark, true);
      document.removeEventListener("keydown", mark, true);
    };
  }, []);

  useEffect(() => {
    if (shown.current === pathname) {
      return undefined;
    }
    shown.current = pathname;
    // Back and Forward always count: the player pressed them in the browser, where this page cannot see it.
    if (!pressed.current && navigationType !== "POP") {
      return undefined;
    }
    const main = document.getElementById("main");
    const start = document.activeElement;
    const stayed = start !== document.body && main.contains(start);
    // Emptied first, so a page with the same title as the last one is still read out.
    region.current.textContent = "";
    return whenHeading({
      main,
      waitMs,
      onReady: (target) => {
        const untouched = document.activeElement === start || document.activeElement === document.body;
        if (!stayed && untouched) {
          // Back and Forward keep the place the browser scrolled back to, so a long page does not jump to the top.
          focusTarget(target, navigationType === "POP");
        }
        region.current.textContent = document.title;
      },
    });
  }, [pathname, navigationType, waitMs]);

  return <p ref={region} className="visually-hidden" aria-live="polite" aria-atomic="true" />;
}
