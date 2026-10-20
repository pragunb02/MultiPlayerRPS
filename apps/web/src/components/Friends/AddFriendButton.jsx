import { useState } from "react";
import { FRIEND_REQUEST_RESULTS } from "@classicade/shared";
import { useAction } from "../../hooks/useAction.js";
import { useAddFriend } from "../../hooks/useFriends.js";
import { Button } from "../Button/Button.jsx";
import styles from "./Friends.module.css";

/**
 * "Add friend" beside someone an account just played with (CC-052): a seat on the result screen, or a past opponent
 * in match history. The page names them by their seat, never by player id, and the server checks the two played
 * there. Once sent it says so, the same whatever the other player does, so a decline or a block never shows
 * (ADR-053). Only accounts are offered it. A guest finds how to save their progress on the Friends page.
 *
 * @param {{
 *   target: { roomCode: string, seat: number, seatId: string } | { matchId: string, seat: number },
 *   name: string,
 *   control: string,
 * }} props  `name` is the display name the page shows, for the button's accessible name
 */
export function AddFriendButton({ target, name, control }) {
  const addFriend = useAddFriend();
  const [result, setResult] = useState("");
  const add = useAction(async () => setResult(await addFriend(target)), { id: control });

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
      action={add}
      pendingLabel="Sending…"
      aria-label={`Add friend ${name}`}
    >
      Add friend
    </Button>
  );
}
