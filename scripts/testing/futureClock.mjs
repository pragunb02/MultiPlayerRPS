// The time-bomb check (CC-325). With CC_FUTURE_DAYS set, every test runs as if today were that many days later:
// `Date.now()` and `new Date()` are moved ahead, and everything else about dates stays as it was. A test that only
// passes before some day (a fixture written with a fixed date and compared with the real clock) fails here now,
// instead of on that day. Without CC_FUTURE_DAYS this file changes nothing. Run it with `npm run test:future`.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The number of days ahead in `value`, or 0 when it is not set. Anything else stops the run.
 *
 * @param {string | undefined} value
 * @returns {number}
 */
export function futureDays(value) {
  if (value === undefined || value === "") return 0;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(`CC_FUTURE_DAYS must be a whole number of days, not ${JSON.stringify(value)}`);
  }
  return days;
}

/**
 * `RealDate` with its clock `shiftMs` ahead: `now()`, `new Date()` and `Date()`. Dates built from a value stay that
 * value. It is the same constructor seen through a proxy, so its name, prototype and `instanceof` are unchanged and
 * libraries that check for `Date` (Mongoose schemas) still see it.
 *
 * @param {DateConstructor} RealDate
 * @param {number} shiftMs
 * @returns {DateConstructor}
 */
export function shiftedDate(RealDate, shiftMs) {
  const now = () => RealDate.now() + shiftMs;
  return new Proxy(RealDate, {
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget),
    apply: () => new RealDate(now()).toString(),
    get: (target, property, receiver) => (property === "now" ? now : Reflect.get(target, property, receiver)),
  });
}

const days = futureDays(process.env.CC_FUTURE_DAYS);
if (days > 0) {
  globalThis.Date = shiftedDate(Date, days * DAY_MS);
}
