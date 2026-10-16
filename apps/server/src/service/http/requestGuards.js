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
 * @param {{ allowedOrigins: ReadonlyArray<string> }} options
 * @returns {import("express").RequestHandler}
 */
export function createCsrfGuard({ allowedOrigins }) {
  const allowed = new Set(allowedOrigins);
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
    if (hasBody && !req.is("application/json")) {
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
