import { defineBot } from "../bots/bot.js";
import { randomIndex } from "../rng.js";

/**
 * A tiny reference bot for the race engine, used to test the bot tooling itself. "Lucky" adds 1 or 2
 * at random, but never more than is left. "Careful" plays the winning rule of the race: leave the other
 * player a multiple of three to go.
 */
export const raceBot = defineBot({
  gameId: "race",
  levels: [
    { id: "lucky", name: "Lucky", description: "Adds 1 or 2 at random." },
    { id: "careful", name: "Careful", description: "Leaves you a multiple of three to go whenever it can." },
  ],
  chooseMove({ view, rng, difficulty }) {
    const left = view.target - view.count;
    if (difficulty === "careful") {
      return { add: left % 3 === 0 ? 1 : left % 3 };
    }
    return { add: Math.min(left, 1 + randomIndex(rng, 2)) };
  },
});
