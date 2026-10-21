import { useEffect, useRef, useState } from "react";

// Just after the first page has drawn, so it never competes with it and is there before the first press.
const PREFETCH_AFTER_MS = 300;

/** The dialog's component once its code has loaded, shared by every player's copy on this page. */
let loaded;
const loadFeedbackDialog = () =>
  import("../Feedback/FeedbackDialog.jsx").then((module) => {
    loaded = module.FeedbackDialog;
    return loaded;
  });

/**
 * The Feedback dialog (CC-290), with its code in a chunk of its own, so it is not in the first route (CC-324, from
 * CC-322's bundle work: about 2.5 kB gzip). The chunk is fetched just after the first page has drawn, or at once on
 * the first press, and the dialog is drawn as soon as it is there. Not React's `lazy`: a suspended component is shown
 * up to several hundred ms after its code arrives, which breaks the match shell's 100 ms rule for a press.
 *
 * When the chunk cannot be fetched while the player is waiting for the dialog, the press is undone (`onClose`), so
 * the next press tries again instead of finding Feedback stuck open and invisible.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   load?: () => Promise<import("react").ComponentType<{ open: boolean, onClose: () => void }>>,
 * }} props  `load` is for tests
 */
export function LazyFeedbackDialog({ open, onClose, load = loadFeedbackDialog }) {
  const [Dialog, setDialog] = useState(() => (load === loadFeedbackDialog ? loaded : undefined));
  const latest = useRef({ open, onClose });
  useEffect(() => {
    latest.current = { open, onClose };
  });

  useEffect(() => {
    if (Dialog !== undefined) return undefined;
    let live = true;
    const start = () =>
      load().then(
        (component) => live && setDialog(() => component),
        () => {
          // A failed prefetch changes nothing; a failed press is undone, so the next press loads it again.
          if (live && latest.current.open) latest.current.onClose();
        },
      );
    const timer = setTimeout(start, open ? 0 : PREFETCH_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [Dialog, open, load]);

  return Dialog === undefined ? null : <Dialog open={open} onClose={onClose} />;
}
