/**
 * Where to go after signing in: the `next` query parameter if it is a safe in-app path, otherwise home.
 * Only same-site relative paths are accepted, so a crafted link cannot send players to another site.
 *
 * @param {URLSearchParams} params
 */
export function nextPath(params) {
  const next = params.get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}
