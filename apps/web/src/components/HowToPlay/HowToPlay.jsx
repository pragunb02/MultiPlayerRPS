import { useState } from "react";
import { Svg } from "../../art/Svg.jsx";
import { gameArtFor } from "../../art/games/gameArt.js";
import artStyles from "../../art/games/gameArt.module.css";
import { howToPlayFor, stepCount } from "../../games/howToPlay.js";
import { Button } from "../Button/Button.jsx";
import { Modal } from "../Modal/Modal.jsx";
import styles from "./HowToPlay.module.css";

/**
 * A game's How to play steps as a numbered list, each beside a glyph in the game's colour (CC-259). The glyphs are
 * decoration and the words carry the rules. On a page that speaks Hinglish each step has its Hinglish line first
 * and the English under it, as every bilingual line does (ADR-051).
 *
 * @param {{
 *   gameId: string,
 *   steps: ReadonlyArray<import("../../games/howToPlay.js").HowToPlayStep>,
 *   bilingual?: boolean,
 * }} props
 */
function Steps({ gameId, steps, bilingual = false }) {
  const tone = artStyles[gameArtFor(gameId).tone];
  return (
    <ol className={styles.steps}>
      {steps.map(({ Glyph, text, hinglish }) => (
        <li key={text} className={styles.step}>
          <Svg viewBox="0 0 64 64" className={`${styles.glyph} ${tone}`}>
            <Glyph />
          </Svg>
          {bilingual ? (
            <span className={styles.bilingual}>
              <span lang="hi-Latn">{hinglish}</span>
              <span lang="en" className={styles.english}>
                {text}
              </span>
            </span>
          ) : (
            <span>{text}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The lobby's "How to play" strip under the cards, as it was before CC-349. It stays while the `how_to_play` flag
 * is off. A game with no steps shows nothing.
 *
 * @param {{ gameId: string }} props
 */
export function HowToPlayStrip({ gameId }) {
  const steps = howToPlayFor(gameId);
  if (steps.length === 0) {
    return null;
  }
  return (
    <section className={styles.strip} aria-labelledby="how-to-play">
      <h2 id="how-to-play">How to play</h2>
      <Steps gameId={gameId} steps={steps} />
    </section>
  );
}

/**
 * How to play as one line, "How to play: 3 steps", that opens in place to the steps (CC-349). It sits near the top
 * of a lobby and under the question on an invite or a challenge, so a player reads the rules before choosing, and
 * it takes one line of a phone's screen until opened. A game with no steps shows nothing.
 *
 * @param {{ gameId: string, bilingual?: boolean, className?: string }} props  `bilingual` for a page that speaks
 *   Hinglish. `className` places it on its page
 */
export function HowToPlayFold({ gameId, bilingual = false, className = "" }) {
  const steps = howToPlayFor(gameId);
  if (steps.length === 0) {
    return null;
  }
  return (
    <details className={`${styles.fold} ${className}`.trim()} data-cc-slot="how-to-play">
      <summary className={styles.summary} data-cc-control="how_to_play.open">
        How to play: {stepCount(steps)}
      </summary>
      <Steps gameId={gameId} steps={steps} bilingual={bilingual} />
    </details>
  );
}

/**
 * The "How to play" button of a match (CC-349). It opens the app's one dialog with the game's steps. The game goes
 * on behind it: nothing is sent and no clock stops. Escape, a tap outside or "Back to the game" closes it, and the
 * focus comes back to the button. A game with no steps shows no button.
 *
 * @param {{ gameId: string, gameName: string, onOpen?: () => void }} props  `onOpen` is told each time the dialog
 *   opens
 */
export function HowToPlayButton({ gameId, gameName, onOpen }) {
  const [open, setOpen] = useState(false);
  const steps = howToPlayFor(gameId);
  if (steps.length === 0) {
    return null;
  }

  function show() {
    setOpen(true);
    onOpen?.();
  }

  return (
    <>
      <Button control="match.how_to_play" variant="ghost" onClick={show}>
        How to play
      </Button>
      <Modal
        open={open}
        title={`How to play ${gameName}`}
        onClose={() => setOpen(false)}
        actions={
          <Button control="match.how_to_play.close" onClick={() => setOpen(false)}>
            Back to the game
          </Button>
        }
      >
        <Steps gameId={gameId} steps={steps} />
      </Modal>
    </>
  );
}
