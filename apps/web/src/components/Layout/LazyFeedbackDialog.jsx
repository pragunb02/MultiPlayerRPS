import { useEffect, useState } from "react";

// Just after the first page has drawn, so it never competes with it and is there before the first press.
const PREFETCH_AFTER_MS = 300;

/** The dialog's component once its code has loaded, shared by every player's copy on this page. */
let loaded;
const load = () =>
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
 * @param {{ open: boolean, onClose: () => void }} props
 */
export function LazyFeedbackDialog({ open, onClose }) {
  const [Dialog, setDialog] = useState(() => loaded);

  useEffect(() => {
    if (Dialog !== undefined) return undefined;
    let live = true;
    // A failed load leaves the page as it was; the next press or page tries again.
    const start = () =>
      load().then(
        (component) => live && setDialog(() => component),
        () => {},
      );
    const timer = setTimeout(start, open ? 0 : PREFETCH_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [Dialog, open]);

  return Dialog === undefined ? null : <Dialog open={open} onClose={onClose} />;
}
