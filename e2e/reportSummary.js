// Reads Playwright JSON reports for the merged CI run (CC-236). The suite runs in parts on separate machines, so
// this proves that together they ran exactly the tests `playwright test --list` finds, each once, and prints how
// long each file took, which is what shards.js is balanced by.

/**
 * @typedef {{ projectName: string, results: { duration: number, status: string }[], status: string }} JsonTest
 * @typedef {{ id: string, title: string, file: string, line: number, tests: JsonTest[] }} JsonSpec
 * @typedef {{ title: string, file: string, specs?: JsonSpec[], suites?: JsonSuite[] }} JsonSuite
 * @typedef {{ suites: JsonSuite[] }} JsonReport
 * @typedef {{ key: string, name: string, file: string, project: string, results: JsonTest["results"], status: string }} Entry
 */

/**
 * Every test in a report, once per project, with the spec file it was loaded from.
 *
 * @param {JsonReport} report
 * @returns {Entry[]}
 */
export function testsIn(report) {
  /** @type {Entry[]} */
  const out = [];
  /** @param {JsonSuite} suite @param {string} file @param {string[]} path */
  const walk = (suite, file, path) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        out.push({
          key: `${spec.id} ${test.projectName}`,
          name: `[${test.projectName}] ${file} › ${[...path, spec.title].join(" › ")}`,
          file,
          project: test.projectName,
          results: test.results,
          status: test.status,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, file, [...path, child.title]);
  };
  for (const fileSuite of report.suites) walk(fileSuite, fileSuite.file, []);
  return out;
}

/**
 * What is wrong with a run against the list of tests it should have run: tests that did not run, tests that are
 * not on the list, and tests that ran more than once. An empty list means every test ran exactly once.
 *
 * @param {{ listed: Entry[], ran: Entry[] }} input
 * @returns {string[]}
 */
export function problemsOf({ listed, ran }) {
  const listedKeys = new Set(listed.map((entry) => entry.key));
  const seen = new Map();
  for (const entry of ran)
    seen.set(entry.key, (seen.get(entry.key) ?? 0) + Math.max(entry.results.length, 1));
  return [
    ...listed.filter((entry) => !seen.has(entry.key)).map((entry) => `did not run: ${entry.name}`),
    ...ran.filter((entry) => !listedKeys.has(entry.key)).map((entry) => `not on the list: ${entry.name}`),
    ...new Set(
      ran
        .filter((entry) => seen.get(entry.key) > 1)
        .map((entry) => `ran ${seen.get(entry.key)} times: ${entry.name}`),
    ),
  ];
}

/**
 * How many tests ended each way, as Playwright counts them (expected, skipped, unexpected, flaky).
 *
 * @param {Entry[]} ran
 * @returns {Record<string, number>}
 */
export function countByStatus(ran) {
  const counts = {};
  for (const entry of ran) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return counts;
}

/**
 * The time each file took, per project, longest first, in seconds.
 *
 * @param {Entry[]} ran
 * @returns {{ file: string, total: number, byProject: Record<string, number> }[]}
 */
export function fileTimes(ran) {
  const files = new Map();
  for (const entry of ran) {
    const row = files.get(entry.file) ?? { file: entry.file, total: 0, byProject: {} };
    const seconds = entry.results.reduce((sum, result) => sum + result.duration, 0) / 1000;
    row.total += seconds;
    row.byProject[entry.project] = (row.byProject[entry.project] ?? 0) + seconds;
    files.set(entry.file, row);
  }
  return [...files.values()].sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));
}

/**
 * A Markdown summary of the merged run: the counts, every problem, and the time of each file.
 *
 * @param {{ title: string, listed: Entry[], ran: Entry[] }} input
 * @returns {string}
 */
export function summary({ title, listed, ran }) {
  const problems = problemsOf({ listed, ran });
  const counts = Object.entries(countByStatus(ran))
    .map(([status, count]) => `${count} ${status}`)
    .join(", ");
  const rows = fileTimes(ran);
  const projects = [...new Set(ran.map((entry) => entry.project))].sort();
  const seconds = (value) => (value === undefined ? "" : value.toFixed(1));
  return [
    `## ${title}`,
    "",
    `${listed.length} tests listed, ${ran.length} ran (${counts}).`,
    problems.length === 0
      ? "Every listed test ran exactly once."
      : ["Problems:", "", ...problems.map((problem) => `- ${problem}`)].join("\n"),
    "",
    `| File | Seconds | ${projects.join(" | ")} |`,
    `| --- | ---: | ${projects.map(() => "---:").join(" | ")} |`,
    ...rows.map(
      (row) =>
        `| ${row.file} | ${seconds(row.total)} | ${projects.map((p) => seconds(row.byProject[p])).join(" | ")} |`,
    ),
    "",
  ].join("\n");
}
