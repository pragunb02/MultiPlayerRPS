import {
  Bolt,
  Cactus,
  Cat,
  Comet,
  Crown,
  Dice,
  Fox,
  Knight,
  Owl,
  Planet,
  Robot,
  Rocket,
} from "./AvatarGlyphs.jsx";

/**
 * The drawing and the tile colour of each avatar, by catalogue id. `tone` is a class of `avatars.module.css` for the
 * tile's neon border.
 *
 * @type {Readonly<Record<string, Readonly<{ Glyph: import("react").ComponentType, tone: string }>>>}
 */
export const AVATAR_ART = Object.freeze({
  bolt: Object.freeze({ Glyph: Bolt, tone: "toneGold" }),
  rocket: Object.freeze({ Glyph: Rocket, tone: "toneXp" }),
  robot: Object.freeze({ Glyph: Robot, tone: "toneXp" }),
  cat: Object.freeze({ Glyph: Cat, tone: "toneAccent" }),
  fox: Object.freeze({ Glyph: Fox, tone: "toneRps" }),
  owl: Object.freeze({ Glyph: Owl, tone: "toneTicTacToe" }),
  crown: Object.freeze({ Glyph: Crown, tone: "toneGold" }),
  planet: Object.freeze({ Glyph: Planet, tone: "toneAccent" }),
  dice: Object.freeze({ Glyph: Dice, tone: "toneRps" }),
  knight: Object.freeze({ Glyph: Knight, tone: "toneChess" }),
  cactus: Object.freeze({ Glyph: Cactus, tone: "toneTicTacToe" }),
  comet: Object.freeze({ Glyph: Comet, tone: "toneXp" }),
});
