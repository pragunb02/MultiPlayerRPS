import { Button } from "../Button/Button.jsx";
import { Modal } from "../Modal/Modal.jsx";

/**
 * The shell's one confirmation dialog, for leaving a game that is still on and for any game action that asks
 * first (resigning a chess game). Keep is the first button, so a stray Enter keeps the game going.
 *
 * @param {{
 *   open: boolean,
 *   title: string,
 *   body: string,
 *   keepControl: string,
 *   confirmControl: string,
 *   keepLabel: string,
 *   confirmLabel: string,
 *   onClose: () => void,
 *   onConfirm: () => void,
 *   action?: ReturnType<typeof import("../../hooks/useAction.js").useAction>,
 *   reason?: string,
 * }} props  `keepControl` and `confirmControl`: the two buttons' `data-cc-control` names. `action` and `reason`:
 *   the confirm button's feedback and why it cannot be pressed now, when it sends something itself
 */
export function ConfirmDialog({
  open,
  title,
  body,
  keepControl,
  confirmControl,
  keepLabel,
  confirmLabel,
  onClose,
  onConfirm,
  action,
  reason = "",
}) {
  return (
    <Modal
      surface="dialog.confirm_leave"
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button control={keepControl} variant="secondary" onClick={onClose}>
            {keepLabel}
          </Button>
          <Button control={confirmControl} action={action} reason={reason} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
    </Modal>
  );
}
