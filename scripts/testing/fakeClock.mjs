/**
 * A clock that only moves when told, with a sleep that moves it, so retry timing is tested without waiting.
 *
 * @param {string} start ISO time
 */
export function fakeClock(start) {
  let current = Date.parse(start);
  /** @type {number[]} */
  const sleeps = [];
  return {
    now: () => current,
    /** @param {number} ms */
    advance: (ms) => {
      current += ms;
    },
    /** @param {number} ms */
    sleep: async (ms) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
  };
}

/**
 * A fetch answered by a function of the URL, which may also move the clock to stand for a slow answer.
 *
 * @param {(url: string, init: RequestInit) => Response | Promise<Response>} answer
 */
export function fakeFetch(answer) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const calls = [];
  const fetch = /** @type {typeof globalThis.fetch} */ (
    /** @type {unknown} */ (
      async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
        calls.push({ url, init });
        return answer(url, init);
      }
    )
  );
  return { fetch, calls };
}
