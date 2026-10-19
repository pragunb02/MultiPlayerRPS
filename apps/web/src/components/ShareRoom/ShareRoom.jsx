import { paths } from "../../app/paths.js";
import { siteOrigin } from "../../app/siteOrigin.js";
import { useAction } from "../../hooks/useAction.js";
import { inviteText, shareMessage, shareWasCancelled } from "../../lib/shareText.js";
import { Button } from "../Button/Button.jsx";
import { useToast } from "../Toast/toastContext.js";
import { WhatsAppLink } from "../WhatsAppLink/WhatsAppLink.jsx";
import styles from "./ShareRoom.module.css";

/**
 * Invite a friend: the room link, copy to clipboard, WhatsApp (CC-217), and the device's share sheet where
 * available. The message names the actual game (the legacy app said "Tic Tac Toe" for every game, BUG-12). The link
 * is on the site's own address, whichever address this page was opened at.
 *
 * @param {{ code: string, gameId: string, origin?: string }} props  origin: the site's own address
 */
export function ShareRoom({ code, gameId, origin = siteOrigin() }) {
  const toast = useToast();
  const url = `${origin}${paths.room(gameId, code)}`;
  const text = inviteText({ gameId, code });
  const canShare = typeof navigator.share === "function";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch (cause) {
      // Shown under the button. The browser's own reason means nothing to a player.
      throw new Error("Couldn't copy. Select the link and copy it", { cause });
    }
    toast.show("Link copied", { tone: "success" });
  };

  const copy = useAction(copyLink, { id: "invite.copy" });

  const share = useAction(
    async () => {
      try {
        await navigator.share({ title: "ClassiCade", text, url });
      } catch (error) {
        // The player closed the share sheet, so there is nothing to do. Any other refusal copies the link instead,
        // so the press still does something.
        if (!shareWasCancelled(error)) await copyLink();
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
        <WhatsAppLink message={shareMessage({ text, url })} control="invite.whatsapp" />
        {canShare && (
          <Button control="invite.share" variant="secondary" action={share}>
            Share…
          </Button>
        )}
      </div>
    </div>
  );
}
