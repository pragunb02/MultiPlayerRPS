import { siteOrigin } from "../../app/siteOrigin.js";
import { resultShare } from "../../games/resultShare.js";
import { useAction } from "../../hooks/useAction.js";
import { shareWasCancelled } from "../../lib/shareText.js";
import { Button } from "../Button/Button.jsx";
import { useToast } from "../Toast/toastContext.js";
import { WhatsAppLink } from "../WhatsAppLink/WhatsAppLink.jsx";
import styles from "./ShareResult.module.css";

/**
 * Share the result of a finished game (CC-217): the text it sends, WhatsApp, and the device's share sheet, or a copy
 * of the message where the device has none. The link is the game's page, because the room closes soon after the
 * game. The text names no player, so it is safe for a guest or a minor to send (ADR-028.7). A spectator played
 * nothing and gets nothing to share.
 *
 * @param {{ room: any, origin?: string }} props  room: the finished RoomView. origin: the site's own address
 */
export function ShareResult({ room, origin = siteOrigin() }) {
  const toast = useToast();
  const share = resultShare(room, { origin });

  const send = useAction(
    async () => {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: "ClassiCade", text: share.text, url: share.shareUrl });
          return;
        } catch (error) {
          // The player closed the share sheet, so there is nothing to do. Any other refusal, such as a browser that
          // does not allow sharing here, falls through to a copy, so the press still does something.
          if (shareWasCancelled(error)) return;
        }
      }
      try {
        await navigator.clipboard.writeText(share.message);
      } catch (cause) {
        throw new Error("Couldn't copy. Use the WhatsApp button instead", { cause });
      }
      toast.show("Result copied", { tone: "success" });
    },
    { id: "result.share" },
  );

  if (room.you === "") {
    return null;
  }
  return (
    <div className={styles.share} data-cc-slot="share">
      <p className={styles.preview}>{share.line}</p>
      <div className={styles.buttons}>
        <WhatsAppLink message={share.whatsappMessage} control="result.whatsapp" />
        <Button control="result.share" variant="secondary" action={send}>
          Share result
        </Button>
      </div>
    </div>
  );
}
