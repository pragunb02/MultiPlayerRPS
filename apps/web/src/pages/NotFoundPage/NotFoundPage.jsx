import { Link } from "react-router";
import { paths } from "../../app/paths.js";
import { GameOver404 } from "../../art/illustrations/GameOver404.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import styles from "./NotFoundPage.module.css";

export function NotFoundPage() {
  return (
    <section className={styles.page}>
      <PageTitle>Page not found</PageTitle>
      <GameOver404 className={styles.art} />
      <h1>Page not found</h1>
      <p>
        That page doesn't exist.{" "}
        <Link to={paths.home()} className={styles.home} data-cc-control="notfound.home">
          Back to the games
        </Link>
      </p>
    </section>
  );
}
