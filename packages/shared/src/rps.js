/** Rock Paper Scissors vocabulary shared by the engine and the web client. */
export const RPS_CHOICES = Object.freeze({
  ROCK: "rock",
  PAPER: "paper",
  SCISSORS: "scissors",
});

/** Allowed "best of" values; the first player to win a majority of rounds wins the match. */
export const RPS_BEST_OF = Object.freeze([1, 3, 5, 7]);
