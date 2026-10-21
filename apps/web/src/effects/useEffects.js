import { play } from "./channel.js";

const EFFECTS_API = Object.freeze({ play });

/**
 * The only way a component starts an effect (ADR-075):
 *
 *     const { play } = useEffects();
 *     play("win_burst", { origin: resultCard.getBoundingClientRect() });
 *
 * `play` resolves when the effect ended or was dropped (reduced motion, a hidden tab, a game being played, or
 * more than 2 s behind another one), so a caller never waits on decoration to show what happened.
 *
 * @returns {{ play: typeof play }}
 */
export const useEffects = () => EFFECTS_API;
