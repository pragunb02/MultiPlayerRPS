/**
 * What the sign-up and login forms tell usage counts (CC-174, EVENTS.md 3.3): which form, where `next` points as a
 * kind, and which field and rule stopped a sign-up. Never what was typed, never the path in `next`.
 */

/**
 * The kind of page `next` points at.
 *
 * @param {string} next  a same-site path, from `safeNext`
 * @returns {"room" | "profile" | "leaderboard" | "none"}
 */
export function nextKindOf(next) {
  const path = next.split(/[?#]/)[0];
  if (/^\/(?:games\/[^/]+\/rooms|room)\/[^/]+\/?$/.test(path)) return "room";
  if (path === "/profile") return "profile";
  if (path === "/leaderboards" || path.startsWith("/leaderboards/")) return "leaderboard";
  return "none";
}

/**
 * The rule a sign-up field broke, as a fixed code: empty is `missing`, a short password `too_short`, anything else
 * `format`. The value itself is read here only.
 *
 * @param {"username" | "email" | "password"} field
 * @param {string} value
 * @returns {"missing" | "too_short" | "format"}
 */
export function ruleOf(field, value) {
  if (value.trim() === "") return "missing";
  if (field === "password" && value.length < 8) return "too_short";
  if (field === "username" && value.length < 3) return "too_short";
  return "format";
}
