import { whatsappUrl } from "../../lib/shareText.js";
import styles from "./WhatsAppLink.module.css";

/**
 * A plain link that opens WhatsApp with the message, where the player picks the chat (CC-217). It is a link and not
 * a script, so no code of WhatsApp's runs on our page and nothing is sent until the player sends it. It opens in a
 * new tab, so the room stays open behind it.
 *
 * @param {{ message: string, control: string }} props  message: the whole text, link included. control: its
 *   `data-cc-control` name
 */
export function WhatsAppLink({ message, control }) {
  return (
    <a
      className={styles.link}
      href={whatsappUrl(message)}
      target="_blank"
      rel="noopener noreferrer"
      data-cc-control={control}
    >
      <span className={styles.dot} aria-hidden="true" />
      Send on WhatsApp
    </a>
  );
}
