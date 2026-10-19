import { describe, expect, it } from "vitest";

import { OpsError } from "../lib/errors.mjs";
import { fakeFetch } from "../testing/fakeClock.mjs";
import {
  RENDER_SCHEMA_URL,
  checkBlueprint,
  fetchRenderSchema,
  parseBlueprint,
  runBlueprintCheck,
} from "./blueprintSchema.mjs";

// A small schema in the same dialect and style as Render's: 2020-12, `definitions`, and `required` without a
// `type` beside it (Ajv's strict mode refuses that, Render's real schema does it at its root).
const schema = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RENDER_SCHEMA_URL,
  type: "object",
  definitions: {
    service: {
      type: "object",
      properties: {
        name: { type: "string" },
        autoDeployTrigger: { enum: ["off", "commit", "checksPass"] },
        maintenanceMode: { type: "object", properties: { uri: { type: "string", format: "uri" } } },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  allOf: [{ required: ["services"] }],
  properties: { services: { type: "array", items: { $ref: "#/definitions/service" } } },
  unevaluatedProperties: false,
});

/** A text output that keeps what was written. */
function output() {
  const chunks = /** @type {string[]} */ ([]);
  return { write: (/** @type {string} */ chunk) => chunks.push(chunk), text: () => chunks.join("") };
}

describe("parseBlueprint", () => {
  it("reads a YAML document", () => {
    expect(parseBlueprint("services:\n  - name: web\n")).toEqual({ services: [{ name: "web" }] });
  });

  it("refuses a key written twice, which YAML would otherwise resolve silently", () => {
    expect(() => parseBlueprint("services: []\nservices: []\n")).toThrow(OpsError);
    expect(() => parseBlueprint("services: []\nservices: []\n")).toThrow(/Map keys must be unique/);
  });

  it("refuses broken YAML and says where", () => {
    expect(() => parseBlueprint("services:\n  - name: [web\n")).toThrow(
      /render\.yaml is not valid YAML: .*line/,
    );
  });

  it("refuses an empty file", () => {
    expect(() => parseBlueprint("")).toThrow(/render\.yaml is empty/);
  });
});

describe("checkBlueprint", () => {
  it("finds no problem in a file that matches the schema", () => {
    expect(
      checkBlueprint({ text: "services:\n  - name: web\n    autoDeployTrigger: checksPass\n", schema }),
    ).toEqual([]);
  });

  it("names a field the schema does not know, such as a typo", () => {
    const problems = checkBlueprint({
      text: "services:\n  - name: web\n    autoDeployTriger: checksPass\n",
      schema,
    });

    expect(problems).toContain('/services/0 must NOT have additional properties ("autoDeployTriger")');
  });

  it("names a value the schema does not allow", () => {
    const problems = checkBlueprint({
      text: "services:\n  - name: web\n    autoDeployTrigger: checks_pass\n",
      schema,
    });

    expect(problems).toContain("/services/0/autoDeployTrigger must be equal to one of the allowed values");
  });

  it("names a missing required field at the root", () => {
    expect(checkBlueprint({ text: "databases: []\n", schema })).toEqual(
      expect.arrayContaining(["/ must have required property 'services'"]),
    );
  });

  it("checks addresses written as uri", () => {
    const text = (/** @type {string} */ uri) =>
      `services:\n  - name: web\n    maintenanceMode:\n      uri: ${uri}\n`;

    expect(checkBlueprint({ text: text("https://example.com/maintenance"), schema })).toEqual([]);
    expect(checkBlueprint({ text: text("not a uri"), schema })).toEqual([
      '/services/0/maintenanceMode/uri must match format "uri"',
    ]);
  });

  it("reports each problem once", () => {
    const problems = checkBlueprint({ text: "services:\n  - name: web\n    a: 1\n    a2: 2\n", schema });

    expect(new Set(problems).size).toBe(problems.length);
  });
});

describe("fetchRenderSchema", () => {
  it("downloads Render's published schema", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(schema));

    await expect(fetchRenderSchema({ fetch })).resolves.toEqual(schema);
    expect(calls.map((call) => call.url)).toEqual([RENDER_SCHEMA_URL]);
  });

  it("fails when render.com does not answer 200", async () => {
    const { fetch } = fakeFetch(() => new Response("busy", { status: 503 }));

    await expect(fetchRenderSchema({ fetch })).rejects.toThrow(
      new OpsError(`${RENDER_SCHEMA_URL} answered 503, so render.yaml could not be checked`),
    );
  });

  it("fails when the answer is not JSON", async () => {
    const { fetch } = fakeFetch(() => new Response("<html>", { status: 200 }));

    await expect(fetchRenderSchema({ fetch })).rejects.toThrow(/is not JSON/);
  });

  it("fails when the answer is some other schema", async () => {
    const { fetch } = fakeFetch(() => Response.json({ ...schema, $id: "https://example.com/other.json" }));

    await expect(fetchRenderSchema({ fetch })).rejects.toThrow(/is not Render's Blueprint schema/);
  });
});

describe("runBlueprintCheck", () => {
  /** @param {{ text: string, answer?: () => Response }} params */
  async function run({ text, answer = () => Response.json(schema) }) {
    const stdout = output();
    const stderr = output();
    const { fetch } = fakeFetch(answer);
    const code = await runBlueprintCheck({ readBlueprint: async () => text, fetch, stdout, stderr });
    return { code, stdout: stdout.text(), stderr: stderr.text() };
  }

  it("passes a valid file and says so", async () => {
    const result = await run({ text: "services:\n  - name: web\n" });

    expect(result).toEqual({
      code: 0,
      stdout: `render.yaml matches Render's Blueprint schema (${RENDER_SCHEMA_URL}).\n`,
      stderr: "",
    });
  });

  it("fails an invalid file and lists every problem", async () => {
    const result = await run({
      text: "services:\n  - name: web\n    autoDeployTrigger: checks_pass\n    x: 1\n",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      [
        "render.yaml does not match Render's Blueprint schema:",
        '  /services/0 must NOT have additional properties ("x")',
        "  /services/0/autoDeployTrigger must be equal to one of the allowed values",
        "",
      ].join("\n"),
    );
  });

  it("fails with the reason when the file cannot be parsed", async () => {
    const result = await run({ text: "a: 1\na: 2\n" });

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^render\.yaml is not valid YAML: .*Map keys must be unique/);
  });

  it("fails with the reason when the schema cannot be downloaded", async () => {
    const result = await run({ text: "services: []\n", answer: () => new Response("", { status: 500 }) });

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `${RENDER_SCHEMA_URL} answered 500, so render.yaml could not be checked\n`,
    });
  });

  it("lets a failure that is not an operator error through", async () => {
    const stdout = output();
    const stderr = output();
    const broken = new TypeError("bug");

    await expect(
      runBlueprintCheck({
        readBlueprint: async () => {
          throw broken;
        },
        fetch: fakeFetch(() => Response.json(schema)).fetch,
        stdout,
        stderr,
      }),
    ).rejects.toBe(broken);
  });
});
