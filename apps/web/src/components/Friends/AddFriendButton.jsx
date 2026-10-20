import { useState } from "react";
import { FRIEND_REQUEST_RESULTS } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useAction } from "../../hooks/useAction.js";
import { useAddFriend } from "../../hooks/useFriends.js";
import { useSession } from "../../hooks/useSession.js";
import { Button } from "../Button/Button.jsx";
import { useToast } from "../Toast/toastContext.js";
import styles from "./Friends.module.css";

/** What a guest is told when they press Add friend (owner decision, CC-052). */
export const GUEST_REASON = "Save your progress to add friends";

/**
 * "Add friend" beside someone the player just played with (CC-052): a seat in a room, which the result screen shows
 * too, or a past opponent in match history. The page names them by their seat, never by player id, and the server
 * checks the two played there. Once sent it says so, the same whatever the other player does, so a decline or a
 * block never shows (ADR-053). A guest who presses it is told to save their progress, with the way to do it. That
 * is a toast, not the button's own reason under it, which would not fit beside a seat on a phone.
 *
 * @param {{
 *   target: { roomCode: string, seat: number, seatId: string } | { matchId: string, seat: number },
 *   name: string,
 *   control: string,
 * }} props  `name` is the display name the page shows, for the button's accessible name
 */
export function AddFriendButton({ target, name, control }) {
  const { identity } = useSession();
  const toast = useToast();
  const addFriend = useAddFriend();
  const [result, setResult] = useState("");
  const add = useAction(async () => setResult(await addFriend(target)), { id: control });
  const account = identity?.kind === "user";
  const askToSave = () =>
    toast.show(GUEST_REASON, {
      tone: "info",
      action: {
        label: "Save progress",
        to: paths.signup(paths.friends()),
        dismissLabel: "Close",
        onDismiss: () => undefined,
      },
    });

  if (result === FRIEND_REQUEST_RESULTS.FRIENDS) {
    return <span className={styles.tag}>friends</span>;
  }
  if (result === FRIEND_REQUEST_RESULTS.SENT) {
    return <span className={styles.tag}>request sent</span>;
  }
  return (
    <Button
      control={control}
      variant="ghost"
      className={styles.add}
      {...(account ? { action: add, pendingLabel: "Sending…" } : { onClick: askToSave })}
      aria-label={`Add friend ${name}`}
    >
      Add friend
    </Button>
  );
}
