import { useEffect, useState } from "react";

/**
 * The form and its fields are their own file, so they are not on the first route (CC-322, CC-323). The page asks for
 * it once it is idle, so by the time a player presses Feedback it is already here and the dialog opens at once
 * (every press answers within 100 ms, CC-164). Asking twice downloads it once.
 */
let request;
let loadedForm;
const loadForm = () => {
  request ??= import("./FeedbackForm.jsx").then(
    (module) => {
      loadedForm = module.FeedbackForm;
      return loadedForm;
    },
    (cause) => {
      // A lost connection: the next press asks again instead of keeping the failure.
      request = undefined;
      throw cause;
    },
  );
  return request;
};

/** Runs `work` when the browser is idle, or after a second where it cannot say. Answers a function that cancels it. */
function whenIdle(work) {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(work);
    return () => window.cancelIdleCallback(id);
  }
  const timer = setTimeout(work, 1_000);
  return () => clearTimeout(timer);
}

/**
 * The Feedback dialog (CC-290). Nothing is drawn until it first opens. From then on the form stays mounted, so a
 * draft is kept while the dialog is closed, as it always was (FeedbackForm).
 *
 * @param {{ open: boolean, onClose: () => void }} props
 */
export function FeedbackDialog({ open, onClose }) {
  const [Form, setForm] = useState(() => loadedForm);
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);

  useEffect(() => {
    if (Form !== undefined) return undefined;
    let current = true;
    const fetchForm = () =>
      loadForm().then(
        (loaded) => {
          if (current) setForm(() => loaded);
        },
        () => undefined,
      );
    const cancel = open ? (fetchForm(), () => {}) : whenIdle(fetchForm);
    return () => {
      current = false;
      cancel();
    };
  }, [Form, open]);

  if (!opened || Form === undefined) return null;
  return <Form open={open} onClose={onClose} />;
}
