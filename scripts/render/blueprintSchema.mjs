import { Ajv2020 } from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

import { OpsError } from "../lib/errors.mjs";

/** Render publishes its Blueprint spec as a JSON Schema here, and SchemaStore points editors at the same address. */
export const RENDER_SCHEMA_URL = "https://render.com/schema/render.yaml.json";

/**
 * Reads render.yaml. A key written twice or broken YAML stops the check, because Render would read such a file in
 * a way nobody reviewed.
 *
 * @param {string} text  the contents of render.yaml
 * @returns {unknown}
 */
export function parseBlueprint(text) {
  const document = parseDocument(text, { uniqueKeys: true, prettyErrors: true });
  if (document.errors.length > 0) {
    throw new OpsError(
      `render.yaml is not valid YAML: ${document.errors.map((error) => error.message).join(" ")}`,
    );
  }
  const value = document.toJS();
  if (value === null || value === undefined) {
    throw new OpsError("render.yaml is empty");
  }
  return value;
}

/**
 * Checks render.yaml against Render's Blueprint schema.
 *
 * @param {{ text: string, schema: object }} params  `text` is the contents of render.yaml
 * @returns {readonly string[]} one line per problem, empty when the file matches
 */
export function checkBlueprint({ text, schema }) {
  // Strict mode checks how a schema is written, not the data. Render's schema puts `required` beside no `type`,
  // which strict mode refuses, so it is off. Every rule in the schema still applies to render.yaml.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("uri", (value) => URL.canParse(value));
  const validate = ajv.compile(schema);
  if (validate(parseBlueprint(text))) {
    return Object.freeze([]);
  }
  // Ajv always sets `errors` when the data does not match.
  const errors = /** @type {import("ajv").ErrorObject[]} */ (validate.errors);
  const problems = errors.map((error) => {
    const extra = error.params.additionalProperty ?? error.params.unevaluatedProperty;
    return `${error.instancePath || "/"} ${error.message}${extra === undefined ? "" : ` ("${extra}")`}`;
  });
  return Object.freeze([...new Set(problems)]);
}

/**
 * Downloads Render's current Blueprint schema. One attempt: if render.com does not answer, the check fails and says
 * so, and nobody mistakes an unchecked file for a checked one.
 *
 * @param {{ fetch: typeof fetch }} params
 * @returns {Promise<object>}
 */
export async function fetchRenderSchema({ fetch }) {
  const response = await fetch(RENDER_SCHEMA_URL);
  if (!response.ok) {
    throw new OpsError(
      `${RENDER_SCHEMA_URL} answered ${response.status}, so render.yaml could not be checked`,
    );
  }
  let schema;
  try {
    schema = await response.json();
  } catch (error) {
    throw new OpsError(`${RENDER_SCHEMA_URL} is not JSON, so render.yaml could not be checked`, {
      cause: error,
    });
  }
  if (schema?.$id !== RENDER_SCHEMA_URL) {
    throw new OpsError(`${RENDER_SCHEMA_URL} is not Render's Blueprint schema (its $id is "${schema?.$id}")`);
  }
  return schema;
}

/**
 * The whole check as the CI job runs it. Returns the exit code.
 *
 * @param {{
 *   readBlueprint: () => Promise<string>,
 *   fetch: typeof fetch,
 *   stdout: { write: (text: string) => unknown },
 *   stderr: { write: (text: string) => unknown },
 * }} params  `readBlueprint` returns the contents of render.yaml
 * @returns {Promise<number>}
 */
export async function runBlueprintCheck({ readBlueprint, fetch, stdout, stderr }) {
  try {
    const text = await readBlueprint();
    const problems = checkBlueprint({ text, schema: await fetchRenderSchema({ fetch }) });
    if (problems.length > 0) {
      stderr.write(
        `render.yaml does not match Render's Blueprint schema:\n${problems.map((line) => `  ${line}\n`).join("")}`,
      );
      return 1;
    }
    stdout.write(`render.yaml matches Render's Blueprint schema (${RENDER_SCHEMA_URL}).\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof OpsError)) throw error;
    stderr.write(`${error.message}\n`);
    return 1;
  }
}
