import { GameArt } from "../src/art/games/GameArt.jsx";
import { HeroArt } from "../src/art/HeroArt.jsx";
import { Logo } from "../src/art/Logo.jsx";
import styles from "./OgCard.module.css";

/**
 * One link preview image, drawn with the app's own art and design tokens so previews look like the site.
 * render.mjs takes a 1200 by 630 screenshot of it.
 *
 * @param {{ game?: Readonly<import("@classicade/shared").GameInfo> }} props  no game: the site's own card
 */
export function OgCard({ game }) {
  return (
    <div className={styles.card}>
      <div className={styles.text}>
        <span className={styles.brand}>
          <Logo />
        </span>
        <h1 className={`${styles.headline} ${game ? "" : styles.long}`}>
          {game ? game.name : "Classic games with anyone, anywhere"}
        </h1>
        <p className={styles.subline}>
          {game ? "Play with a friend in one click" : "Rock Paper Scissors, Tic Tac Toe and Chess"}
        </p>
        <p className={styles.footnote}>Free in your browser, no account needed.</p>
      </div>
      {game ? (
        <div className={styles.panel}>
          <GameArt gameId={game.id} className={styles.art} />
        </div>
      ) : (
        <HeroArt className={styles.hero} />
      )}
    </div>
  );
}
