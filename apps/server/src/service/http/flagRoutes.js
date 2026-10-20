import { Router } from "express";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ValidationError } from "../../utils/errors.js";
import { requireIdentity } from "./session.js";

// One page asks for a few flags at most. A longer list is a mistake or an attempt to read them all.
const MAX_NAMES = 20;

const invalid = (field, message) => new ValidationError(message, { details: { field } });

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Who is asking, as the flag rules need it: the session's identity and whether the console allowlist has them.
 * A visitor with no session yet is `undefined`.
 *
 * @param {import("express").Request} req
 * @param {(session: object) => boolean} isAdmin
 * @returns {import("../../domain/flags/flagRules.js").FlagPlayer | undefined}
 */
function playerOf(req, isAdmin) {
  if (req.session.identity === undefined) return undefined;
  const { id, kind } = requireIdentity(req.session);
  return { id, kind, admin: isAdmin(req.session) };
}

/**
 * The flag names a page asks for: a comma separated list of client flags, each once, and nothing else in the query.
 *
 * @param {import("express").Request["query"]} query
 * @param {(name: string) => boolean} isClientFlag
 */
function parseNames(query, isClientFlag) {
  const unknown = Object.keys(query).filter((key) => key !== "names");
  if (unknown.length > 0) {
    throw new ValidationError("Unknown query parameters", { details: { fields: unknown } });
  }
  if (typeof query.names !== "string" || query.names === "") {
    throw invalid("names", "Give the flag names, separated by commas");
  }
  const names = query.names.split(",");
  if (names.length > MAX_NAMES || new Set(names).size !== names.length) {
    throw invalid("names", `Give at most ${MAX_NAMES} flag names, each once`);
  }
  const refused = names.filter((name) => !isClientFlag(name));
  if (refused.length > 0) {
    throw invalid("names", "Ask only for flags the web app may read");
  }
  return names;
}

/**
 * Feature flags over HTTP (CC-312, ADR-073).
 *
 *   GET    /flags?names=a,b              200 { flags: { a: true, b: false } }   only booleans, never cached. 400 for
 *                                       an unknown or server-only flag
 *   POST   /flags/:name/success          204   counts one success on the side the server works out for this player
 *   GET    /admin/flags                  200 { source, days, countsRead, flags }   the console's list
 *   PUT    /admin/flags/:name            200 { flag }   body { rollout: "off" | "on" | 0 to 100 }
 *   DELETE /admin/flags/:name            200 { flag }   back to the rollout in code
 *
 * The admin routes are behind `requireAdmin`: 404 for anyone else (ADR-036). The bucket a player is in is never
 * part of any answer.
 *
 * @param {{
 *   flagComponent: ReturnType<typeof import("../../domain/flags/flagComponent.js").createFlagComponent>,
 *   adminAccess: ReturnType<typeof import("./adminAccess.js").createAdminAccess>,
 * }} deps
 */
export function createFlagRoutes({ flagComponent, adminAccess }) {
  assertDefined(flagComponent, "flagComponent");
  assertFunction(adminAccess?.isAdmin, "adminAccess.isAdmin");
  assertFunction(adminAccess?.requireAdmin, "adminAccess.requireAdmin");
  const router = Router();

  router.get("/flags", async (req, res) => {
    const names = parseNames(req.query, flagComponent.isClientFlag);
    const flags = await flagComponent.resolve(names, playerOf(req, adminAccess.isAdmin));
    res.setHeader("Cache-Control", "no-store");
    res.json({ flags });
  });

  router.post("/flags/:name/success", async (req, res) => {
    if (!flagComponent.isClientFlag(req.params.name)) {
      throw invalid("name", "Not a flag the web app may read");
    }
    await flagComponent.recordSuccess(req.params.name, playerOf(req, adminAccess.isAdmin));
    res.status(204).end();
  });

  router.use("/admin/flags", adminAccess.requireAdmin);

  const listed = async (name) => (await flagComponent.overview()).flags.find((flag) => flag.name === name);

  router.get("/admin/flags", async (req, res) => {
    res.json(await flagComponent.overview());
  });

  router.put("/admin/flags/:name", async (req, res) => {
    if (!isPlainObject(req.body) || Object.keys(req.body).some((key) => key !== "rollout")) {
      throw invalid("rollout", "Send { rollout } only");
    }
    await flagComponent.setRollout({ name: req.params.name, rollout: req.body.rollout });
    res.json({ flag: await listed(req.params.name) });
  });

  router.delete("/admin/flags/:name", async (req, res) => {
    await flagComponent.clearRollout({ name: req.params.name });
    res.json({ flag: await listed(req.params.name) });
  });

  return router;
}
