import styles from "./Profile.module.css";

/**
 * One message in Hinglish, with its English line under it (CC-034, ADR-051).
 *
 * @param {{ copy: Readonly<{ hi: string, en: string }>, as?: "p" | "span" }} props
 */
export function Bilingual({ copy, as: Tag = "p" }) {
  return (
    <Tag className={styles.bilingual}>
      <span lang="hi-Latn" className={styles.hinglish}>
        {copy.hi}
      </span>{" "}
      <span lang="en" className={styles.english}>
        {copy.en}
      </span>
    </Tag>
  );
}
