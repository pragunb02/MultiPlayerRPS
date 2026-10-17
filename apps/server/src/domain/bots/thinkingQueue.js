/**
 * How long the server rests after a computer player's thinking, for each millisecond of thinking. With 1 it rests as
 * long as it thought, so computer players never use more than half of the server's time.
 */
export const REST_PER_THINKING_MS = 1;

/** Waits `ms` milliseconds on a timer that does not keep the process alive. */
const restFor = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

/**
 * One line for every computer player on the server to think in (CC-138). A strong chess level thinks for up to a
 * quarter of a second, and that thinking holds up everything else the server does: other rooms' moves, chess
 * clocks and every socket. So only one computer player thinks at a time, whichever room and player it plays for.
 * After each one the server rests for as long as the thinking took (see `REST_PER_THINKING_MS`), and in that rest
 * it answers everyone else. A few players starting many games therefore make computer players slower, never the
 * server.
 *
 * @param {{ clock?: () => number, rest?: (ms: number) => Promise<void> }} [deps]  `clock` reads milliseconds and
 *   `rest` waits. Tests give both to see every step
 */
export function createThinkingQueue({ clock = () => performance.now(), rest = restFor } = {}) {
  let line = Promise.resolve();

  return Object.freeze({
    /**
     * Thinks `work` when it is this caller's turn, and answers what it gave or threw.
     *
     * @template T
     * @param {() => T} work  synchronous, such as choosing a chess move
     * @returns {Promise<T>}
     */
    think(work) {
      let spent = 0;
      const turn = line.then(() => {
        const started = clock();
        try {
          return work();
        } finally {
          spent = clock() - started;
        }
      });
      // The next caller waits for the rest, whether this work gave a move or threw.
      const resting = () => rest(spent * REST_PER_THINKING_MS);
      line = turn.then(resting, resting);
      return turn;
    },
  });
}
