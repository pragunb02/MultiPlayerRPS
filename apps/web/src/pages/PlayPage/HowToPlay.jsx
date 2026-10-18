import { Svg } from "../../art/Svg.jsx";
import { gameArtFor } from "../../art/games/gameArt.js";
import artStyles from "../../art/games/gameArt.module.css";
import { gameView } from "../../games/registry.js";
import styles from "./HowToPlay.module.css";

/**
 * The lobby's "How to play" strip (CC-259): a game's three short steps from the client game registry, each beside
 * a glyph in the game's colour. The glyphs are decoration and the words carry the rules. A game with no steps in
 * the registry shows nothing.
 *
 * @param {{ gameId: string }} props
 */
export function HowToPlay({ gameId }) {
  const steps = gameView(gameId).howToPlay ?? [];
  if (steps.length === 0) {
    return null;
  }
  const tone = artStyles[gameArtFor(gameId).tone];
  return (
    <section className={styles.strip} aria-labelledby="how-to-play">
      <h2 id="how-to-play">How to play</h2>
      <ol className={styles.steps}>
        {steps.map(({ Glyph, text }) => (
          <li key={text} className={styles.step}>
            <Svg viewBox="0 0 64 64" className={`${styles.glyph} ${tone}`}>
              <Glyph />
            </Svg>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
