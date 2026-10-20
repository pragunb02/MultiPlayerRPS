// What the load test counts while players play, and how a step is summed up (CC-289).

/**
 * The value below which `p` percent of the sorted values fall (nearest rank).
 *
 * @param {ReadonlyArray<number>} sorted   ascending
 * @param {number} p                       0 to 100
 * @returns {number} 0 for no values
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Times under names starting with this are moves, the round trip NFR-3 limits. */
export const MOVE = "game:move";

const sorted = (map) => [...map].sort(([a], [b]) => a.localeCompare(b));
const round = (value) => Math.round(value * 10) / 10;

/**
 * Count, p50, p95, p99 and max of some times, rounded to a tenth of a millisecond.
 *
 * @param {ReadonlyArray<number>} values
 * @returns {{ count: number, p50: number, p95: number, p99: number, max: number }}
 */
export function summarize(values) {
  const ascending = [...values].sort((a, b) => a - b);
  return {
    count: ascending.length,
    p50: round(percentile(ascending, 50)),
    p95: round(percentile(ascending, 95)),
    p99: round(percentile(ascending, 99)),
    max: round(ascending.at(-1) ?? 0),
  };
}

/**
 * Collects times by name (such as `game:move chess`) and failures by name (such as `room:create SERVER_BUSY`) for
 * the step that is running. `take` hands them over, with every move of every game summed up together in
 * `moves`, and starts the next step empty.
 *
 * @returns {{
 *   time: (name: string, ms: number) => void,
 *   fail: (name: string) => void,
 *   take: () => { moves: ReturnType<typeof summarize>, times: Record<string, ReturnType<typeof summarize>>, failures: Record<string, number>, counts: Record<string, number> },
 *   count: (name: string) => void,
 * }}
 */
export function createRecorder() {
  let times = new Map();
  let failures = new Map();
  let counts = new Map();
  const add = (map, name, value) => map.set(name, (map.get(name) ?? 0) + value);
  return {
    time(name, ms) {
      const list = times.get(name) ?? [];
      list.push(ms);
      times.set(name, list);
    },
    fail: (name) => add(failures, name, 1),
    count: (name) => add(counts, name, 1),
    take() {
      const taken = {
        moves: summarize([...times].flatMap(([name, list]) => (name.startsWith(MOVE) ? list : []))),
        times: Object.fromEntries(sorted(times).map(([name, list]) => [name, summarize(list)])),
        failures: Object.fromEntries(sorted(failures)),
        counts: Object.fromEntries(sorted(counts)),
      };
      times = new Map();
      failures = new Map();
      counts = new Map();
      return taken;
    },
  };
}
