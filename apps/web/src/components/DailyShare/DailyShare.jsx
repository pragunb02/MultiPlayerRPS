import { paths } from "../../app/paths.js";
import { siteOrigin } from "../../app/siteOrigin.js";
import { useAction } from "../../hooks/useAction.js";
import { dailyPuzzleText, shareMessage, shareWasCancelled, withFreeLine } from "../../lib/shareText.js";
import { Button } from "../Button/Button.jsx";
import { useToast } from "../Toast/toastContext.js";
import { WhatsAppLink } from "../WhatsAppLink/WhatsAppLink.jsx";
import styles from "./DailyShare.module.css";

/**
 * The share of a daily puzzle the player has ended (CC-144): the grid as it will be sent, WhatsApp, and the
 * device's share sheet or a copy where there is none, as the result share of a game does (CC-217). The link is the
 * puzzle's page, so a friend gets the same puzzle today. The text names nobody and shows no move, so a guest or a
 * minor can send it and it spoils nothing (ADR-028.7).
 *
 * @param {{ puzzle: any, origin?: string }} props  puzzle: the server's view of an ended puzzle. origin: the site's
 *   own address
 */
export function DailyShare({ puzzle, origin = siteOrigin() }) {
  const toast = useToast();
  const line = dailyPuzzleText({
    kind: puzzle.kind,
    number: puzzle.number,
    status: puzzle.status,
    grid: puzzle.grid,
    hintsTaken: puzzle.hintsTaken,
    streak: puzzle.streak.current,
  });
  const url = `${origin}${paths.daily(puzzle.kind)}`;
  const message = shareMessage({ text: line, url });

  const send = useAction(
    async () => {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: "ClassiCade", text: withFreeLine(line), url });
          return;
        } catch (error) {
          // Closing the share sheet is no error. Any other refusal falls through to a copy.
          if (shareWasCancelled(error)) return;
        }
      }
      try {
        await navigator.clipboard.writeText(message);
      } catch (cause) {
        throw new Error("Couldn't copy. Use the WhatsApp button instead", { cause });
      }
      toast.show("Result copied", { surface: "toast.copied", tone: "success" });
    },
    { id: "daily.share" },
  );

  return (
    <div className={styles.share} data-cc-slot="share">
      <p className={styles.preview}>{line}</p>
      <div className={styles.buttons}>
        <WhatsAppLink message={message} control="daily.whatsapp" />
        <Button control="daily.share" variant="secondary" action={send}>
          Share result
        </Button>
      </div>
    </div>
  );
}
