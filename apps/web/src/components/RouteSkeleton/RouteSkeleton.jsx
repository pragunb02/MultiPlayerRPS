import styles from "./RouteSkeleton.module.css";

/**
 * What a page shows in the moment its code downloads after a click (CC-322): a title bar and three cards in the
 * page's place, tall enough that the footer stays below the screen, so nothing jumps when the page arrives.
 * Screen readers hear "Loading the page".
 *
 * TODO(CC-323): build this from the shared Skeleton once CC-323 lands. Until then it is a local placeholder.
 */
export function RouteSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" data-route-skeleton="">
      <span className="visually-hidden">Loading the page</span>
      <div className={styles.title} aria-hidden="true" />
      <div className={styles.cards} aria-hidden="true">
        <div className={styles.card} />
        <div className={styles.card} />
        <div className={styles.card} />
      </div>
    </div>
  );
}
