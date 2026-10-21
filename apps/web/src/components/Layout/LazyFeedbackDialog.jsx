import { lazy, Suspense, useEffect, useState } from "react";

const loadDialog = () => import("../Feedback/FeedbackDialog.jsx");
const FeedbackDialog = lazy(() => loadDialog().then((module) => ({ default: module.FeedbackDialog })));
// Long enough after the first page that the dialog never competes with it, short enough to be there before a press.
const PREFETCH_AFTER_MS = 2_000;

/**
 * The Feedback dialog (CC-290), loaded on its own the first time it opens, so its code is not in the first route
 * (CC-324, from CC-322's bundle work: about 2.5 kB gzip). It is fetched once the page has been idle a moment, so a
 * press still answers at once (the match shell's 100 ms rule). Once opened it stays mounted until the player
 * changes, as before: the parent gives it a key per player.
 *
 * @param {{ open: boolean, onClose: () => void }} props
 */
export function LazyFeedbackDialog({ open, onClose }) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) {
    setWanted(true);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      // A prefetch only: if it fails, the first open loads it again and shows its own error.
      loadDialog().catch(() => {});
    }, PREFETCH_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!wanted) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <FeedbackDialog open={open} onClose={onClose} />
    </Suspense>
  );
}
