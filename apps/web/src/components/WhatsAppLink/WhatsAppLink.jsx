import { whatsappUrl } from "../../lib/shareText.js";
import { Button } from "../Button/Button.jsx";
import styles from "./WhatsAppLink.module.css";

/**
 * A plain link that opens WhatsApp with the message, where the player picks the chat (CC-217). It is a link and not
 * a script, so no code of WhatsApp's runs on our page and nothing is sent until the player sends it. It opens in a
 * new tab, so the room stays open behind it. It is the shared secondary button in its link form (CC-323).
 *
 * @param {{ message: string, control: string }} props  message: the whole text, link included. control: its
 *   `data-cc-control` name
 */
export function WhatsAppLink({ message, control }) {
  return (
    <Button
      as="link"
      href={whatsappUrl(message)}
      target="_blank"
      rel="noopener noreferrer"
      control={control}
      variant="secondary"
      icon={<span className={styles.dot} />}
    >
      Send on WhatsApp
    </Button>
  );
}
