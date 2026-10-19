// Shows how the web tests behave on a busy machine (CC-288). React runs effects a moment after it changes the page,
// through setImmediate in Node, and on a loaded CI runner that moment grows. A test that acts as soon as the page
// changes then sees state from before the effects. With CC_SLOW_EFFECTS_MS=25 every such moment takes that long, so
// those tests fail every time instead of now and then:
//
//   CC_SLOW_EFFECTS_MS=25 npx vitest run --project web
//
// It must load before React does, so it is the first setup file. Without the variable it changes nothing.
const delayMs = Number(globalThis.process.env.CC_SLOW_EFFECTS_MS ?? 0);
if (delayMs > 0) {
  const realSetImmediate = globalThis.setImmediate;
  // Kept from before any test fakes the timers, so the delay still passes under fake timers.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setImmediate = (callback, ...args) =>
    realSetTimeout(() => realSetImmediate(callback, ...args), delayMs);
}
