import { SHARE_CHANNELS } from "@classicade/shared";
import { paths, withShareChannel } from "../../app/paths.js";
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
 * is on the site's own address, whichever address this page was opened at. Each way out marks the link with its own
 * channel (CC-279): the box and Copy link with `copy`, WhatsApp with `wa`, the share sheet with `share`.
 *
 * @param {{ code: string, gameId: string, origin?: string }} props  origin: the site's own address
 */
export function ShareRoom({ code, gameId, origin = siteOrigin() }) {
  const toast = useToast();
  const room = `${origin}${paths.room(gameId, code)}`;
  const copied = withShareChannel(room, SHARE_CHANNELS.COPY);
  const text = inviteText({ gameId, code });
  const canShare = typeof navigator.share === "function";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(copied);
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
        await navigator.share({
          title: "ClassiCade",
          text,
          url: withShareChannel(room, SHARE_CHANNELS.SHARE_SHEET),
        });
      } catch (error) {
        // The player closed the share sheet, so there is nothing to do. Any other refusal copies the link instead,
        // so the press still does something. The copied link then travels as a copy, so it is marked as one.
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
        <input readOnly value={copied} onFocus={(event) => event.target.select()} />
      </label>
      <div className={styles.buttons}>
        <Button control="invite.copy" action={copy} doneLabel="Copied">
          Copy link
        </Button>
        <WhatsAppLink
          message={shareMessage({ text, url: withShareChannel(room, SHARE_CHANNELS.WHATSAPP) })}
          control="invite.whatsapp"
        />
        {canShare && (
          <Button control="invite.share" variant="secondary" action={share}>
            Share…
          </Button>
        )}
      </div>
    </div>
  );
}
