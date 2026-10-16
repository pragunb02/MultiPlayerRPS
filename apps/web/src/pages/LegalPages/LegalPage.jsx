import { PageTitle } from "../../components/PageTitle.jsx";
import styles from "./LegalPage.module.css";

/** When the texts were last changed. Change it with every edit, readers compare it with what they saw before. */
export const LEGAL_TEXT_DATE = "16 October 2026";

/**
 * The frame of a legal page: its title, a visible draft note and the text.
 *
 * The texts are drafts written from how the code works today. They are not legal advice, and the owner has them
 * checked by a lawyer before launch (CC-046). The note stays on the page until then, so nobody mistakes a draft
 * for a final policy.
 *
 * @param {{ title: string, intro: string, children: import("react").ReactNode }} props
 */
export function LegalPage({ title, intro, children }) {
  return (
    <article className={styles.page}>
      <PageTitle>{title}</PageTitle>
      <h1>{title}</h1>
      <p role="note" className={styles.draft}>
        <strong>Draft.</strong> This text describes how ClassiCade works today and is waiting for review by a
        lawyer. It is not legal advice and may change before launch.
      </p>
      <p className={styles.updated}>Last updated {LEGAL_TEXT_DATE}</p>
      <p className={styles.intro}>{intro}</p>
      {children}
    </article>
  );
}

/**
 * One numbered part of a legal text, with a heading people can jump to.
 *
 * @param {{ title: string, children: import("react").ReactNode }} props
 */
export function LegalSection({ title, children }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
