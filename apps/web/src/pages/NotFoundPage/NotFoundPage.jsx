import { paths } from "../../app/paths.js";
import { GameOver404 } from "../../art/illustrations/GameOver404.jsx";
import { Button } from "../../components/Button/Button.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { EmptyState } from "../../components/States/States.jsx";
import styles from "./NotFoundPage.module.css";

/**
 * A page that does not exist: the shared dead end (CC-323) with one way back. The game over screen above it is the
 * page's picture, and it keeps its name for screen readers, as the empty state's own art slot is decoration only.
 */
export function NotFoundPage() {
  return (
    <section className={styles.page}>
      <PageTitle>Page not found</PageTitle>
      <GameOver404 className={styles.art} />
      <EmptyState
        title="Page not found"
        headingLevel={1}
        action={
          <Button as="link" to={paths.home()} control="notfound.home" size="lg">
            Back to the games
          </Button>
        }
      >
        That page doesn&apos;t exist.
      </EmptyState>
    </section>
  );
}
