import { ForbiddenError, UnsupportedMediaTypeError } from "../../utils/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request forgery defence for state-changing requests (no tokens needed for this same-origin app,
 * see ADR-010):
 *  1. session cookies are SameSite=Lax, so browsers do not attach them to cross-site POST/PUT/DELETE;
 *  2. if the browser says where the request comes from (Origin), it must be one of our origins;
 *  3. request bodies must be JSON — a cross-site page cannot send JSON without a CORS preflight we never allow.
 * Requests without Origin come from non-browser clients, which cannot ride a victim's cookies.
 *
 * One narrow exception to rule 3 (CC-175): a POST to a path in `plainTextPaths` may also be `text/plain`, because
 * `navigator.sendBeacon` sends that. It is only the telemetry route, which changes nothing a player owns, and rules
 * 1 and 2 still apply to it. Every other route still refuses text/plain (a test pins it).
 *
 * @param {{ allowedOrigins: ReadonlyArray<string>, plainTextPaths?: ReadonlyArray<string> }} options
 *   `plainTextPaths` are paths under the guard's mount, such as `/telemetry`
 * @returns {import("express").RequestHandler}
 */
export function createCsrfGuard({ allowedOrigins, plainTextPaths = [] }) {
  const allowed = new Set(allowedOrigins);
  const plainText = new Set(plainTextPaths);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.get("Origin");
    if (origin !== undefined && !allowed.has(origin)) {
      next(new ForbiddenError("Cross-site request refused"));
      return;
    }
    const hasBody = Number(req.get("Content-Length") ?? 0) > 0 || req.get("Transfer-Encoding") !== undefined;
    const plainTextAllowed =
      req.method === "POST" && plainText.has(req.path) && Boolean(req.is("text/plain"));
    if (hasBody && !req.is("application/json") && !plainTextAllowed) {
      next(new UnsupportedMediaTypeError("Send JSON (Content-Type: application/json)"));
      return;
    }
    next();
  };
}

/**
 * Content-Security-Policy for the web app and API: everything from our own origin only, no inline scripts or
 * styles, no plugins, no framing (clickjacking). The app was built to need no exceptions.
 *
 * @param {{ isProduction: boolean }} options
 */
export function contentSecurityPolicy({ isProduction }) {
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(isProduction && { upgradeInsecureRequests: [] }),
    },
  };
}
