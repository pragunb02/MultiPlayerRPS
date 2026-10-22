import { useEventTheme } from "./useEventTheme.js";
import styles from "./EventGreeting.module.css";

/**
 * The active event theme's one greeting line, in Hinglish with its English line (the CC-332 two-language pair),
 * above the home hero's headline. Nothing when no theme is on. It knows no theme by name: the words come from the
 * theme's registry entry (CC-328). The same for every player: no ask, no countdown.
 */
export function EventGreeting() {
  const theme = useEventTheme();
  if (theme?.greeting === undefined) return null;
  return (
    <p className={styles.greeting} data-event-greeting={theme.name}>
      <span lang="hi-Latn" className={styles.hinglish}>
        {theme.greeting.hi}
      </span>{" "}
      <span lang="en" className={styles.english}>
        {theme.greeting.en}
      </span>
    </p>
  );
}
