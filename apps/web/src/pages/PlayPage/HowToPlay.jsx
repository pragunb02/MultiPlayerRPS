import { Svg } from "../../art/Svg.jsx";
import { gameArtFor } from "../../art/games/gameArt.js";
import artStyles from "../../art/games/gameArt.module.css";
import { Card } from "../../components/Card/Card.jsx";
import { Section } from "../../components/Page/Page.jsx";
import { gameView } from "../../games/registry.js";
import styles from "./HowToPlay.module.css";

/**
 * The lobby's "How to play" strip (CC-259): a game's three short steps from the client game registry, each beside
 * a glyph in the game's colour. The glyphs are decoration and the words carry the rules. A game with no steps in
 * the registry shows nothing. It is a titled section of the lobby, each step a card (CC-323).
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
    <Section
      id="how-to-play"
      title="How to play"
      description="Three steps, then it is your move."
      className={styles.strip}
    >
      <ol className={styles.steps}>
        {steps.map(({ Glyph, text }) => (
          <Card as="li" key={text} className={styles.step}>
            <Svg viewBox="0 0 64 64" className={`${styles.glyph} ${tone}`}>
              <Glyph />
            </Svg>
            <span>{text}</span>
          </Card>
        ))}
      </ol>
    </Section>
  );
}
