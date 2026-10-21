import { lazy, Suspense, useState } from "react";

// The form and its fields load the first time the dialog opens, so they are not on the first route (CC-322, CC-323).
const FeedbackForm = lazy(() =>
  import("./FeedbackForm.jsx").then((module) => ({ default: module.FeedbackForm })),
);

/**
 * The Feedback dialog (CC-290). Nothing is drawn or downloaded until it first opens. From then on the form stays
 * mounted, so a draft is kept while the dialog is closed, as it always was (FeedbackForm).
 *
 * @param {{ open: boolean, onClose: () => void }} props
 */
export function FeedbackDialog({ open, onClose }) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  if (!opened) return null;
  return (
    <Suspense fallback={null}>
      <FeedbackForm open={open} onClose={onClose} />
    </Suspense>
  );
}
