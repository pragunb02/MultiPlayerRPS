import { GAME_IDS, RPS_CHOICES } from "@classicade/shared";
import { randomIndex } from "../../rng.js";
import { defineBot } from "../bot.js";

export const RPS_BOT_LEVELS = Object.freeze({ RANDOM: "random", PATTERN: "pattern" });

const CHOICES = Object.freeze([RPS_CHOICES.ROCK, RPS_CHOICES.PAPER, RPS_CHOICES.SCISSORS]);

/** The choice that beats each choice. */
const COUNTER = Object.freeze({
  [RPS_CHOICES.ROCK]: RPS_CHOICES.PAPER,
  [RPS_CHOICES.PAPER]: RPS_CHOICES.SCISSORS,
  [RPS_CHOICES.SCISSORS]: RPS_CHOICES.ROCK,
});

/**
 * How often the pattern reader ignores what it learned and picks at random. Without this it would be
 * a mirror that a player can steer: play rock twice, then switch to beat the paper it is sure to throw.
 */
const SURPRISE_RATE = 0.2;

/** A habit ("after rock I play paper") says more about the next choice than overall favourites do. */
const HABIT_WEIGHT = 2;

const pickRandom = (rng, options) => options[randomIndex(rng, options.length)];

/** The opponent's choices in every resolved round, oldest first, across earlier games and this one. */
function opponentChoices(views, botId) {
  return views.flatMap((view) =>
    view.rounds.map(({ choices }) => Object.entries(choices).find(([player]) => player !== botId)[1]),
  );
}

/**
 * Guesses the opponent's next choice from what usually followed their last choice, plus how often
 * they pick each choice overall. Equal scores are broken at random so the guess is not predictable.
 */
function predict(seen, rng) {
  const last = seen.at(-1);
  const score = Object.fromEntries(CHOICES.map((choice) => [choice, 0]));
  seen.forEach((choice, index) => {
    score[choice] += 1;
    if (index > 0 && seen[index - 1] === last) {
      score[choice] += HABIT_WEIGHT;
    }
  });
  const best = Math.max(...Object.values(score));
  return pickRandom(
    rng,
    CHOICES.filter((choice) => score[choice] === best),
  );
}

function readPattern({ view, botId, rng, history }) {
  const seen = opponentChoices([...history, view], botId);
  if (seen.length === 0 || rng() < SURPRISE_RATE) {
    return pickRandom(rng, CHOICES);
  }
  return COUNTER[predict(seen, rng)];
}

const STRATEGIES = Object.freeze({
  [RPS_BOT_LEVELS.RANDOM]: ({ rng }) => pickRandom(rng, CHOICES),
  [RPS_BOT_LEVELS.PATTERN]: readPattern,
});

/** Rock Paper Scissors bots. Both only read resolved rounds, never the opponent's pending choice. */
export const rpsBot = defineBot({
  gameId: GAME_IDS.RPS,
  levels: [
    {
      id: RPS_BOT_LEVELS.RANDOM,
      name: "Random",
      description: "Picks completely at random, so there is no pattern to find.",
    },
    {
      id: RPS_BOT_LEVELS.PATTERN,
      name: "Pattern reader",
      description: "Learns your habits as you play and throws what beats them, with a few surprises.",
    },
  ],
  chooseMove: (turn) => ({ choice: STRATEGIES[turn.difficulty](turn) }),
});
