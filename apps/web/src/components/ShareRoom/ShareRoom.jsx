import { getGame } from "@classicade/shared";
import { paths } from "../../app/paths.js";
import { useAction } from "../../hooks/useAction.js";
import { Button } from "../Button/Button.jsx";
import { useToast } from "../Toast/toastContext.js";
import styles from "./ShareRoom.module.css";

/**
 * Invite a friend: the room link, copy to clipboard, and the device's share sheet where available.
 * The message names the actual game (the legacy app said "Tic Tac Toe" for every game — BUG-12).
 *
 * @param {{ code: string, gameId: string, origin?: string }} props
 */
export function ShareRoom({ code, gameId, origin = window.location.origin }) {
  const toast = useToast();
  const url = `${origin}${paths.room(gameId, code)}`;
  const gameName = getGame(gameId)?.name ?? "a game";
  const text = `Play ${gameName} with me on ClassiCade — room ${code}`;
  const canShare = typeof navigator.share === "function";

  const copy = useAction(
    async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch (cause) {
        // Shown under the button. The browser's own reason means nothing to a player.
        throw new Error("Couldn't copy. Select the link and copy it", { cause });
      }
      toast.show("Link copied", { tone: "success" });
    },
    { id: "invite.copy" },
  );

  const share = useAction(
    async () => {
      try {
        await navigator.share({ title: "ClassiCade", text, url });
      } catch {
        // The player closed the share sheet, so there is nothing to do.
      }
    },
    { id: "invite.share" },
  );

  return (
    <div className={styles.share}>
      <p className={styles.code}>
        Room code <strong aria-label={`Room code ${code.split("").join(" ")}`}>{code}</strong>
      </p>
      <label className={styles.label}>
        <span>Invite link</span>
        <input readOnly value={url} onFocus={(event) => event.target.select()} />
      </label>
      <div className={styles.buttons}>
        <Button control="invite.copy" action={copy} doneLabel="Copied">
          Copy link
        </Button>
        {canShare && (
          <Button control="invite.share" variant="secondary" action={share}>
            Share…
          </Button>
        )}
      </div>
    </div>
  );
}
