// CI's last browser test step (CC-236): compares the merged report of all parts with the tests Playwright lists,
// writes the summary to the job page and the log, and fails when a test did not run or ran more than once.
// Usage: node report-summary.mjs <title> <listed.json> <merged.json>
import { appendFile, readFile } from "node:fs/promises";

import { problemsOf, summary, testsIn } from "./reportSummary.js";

const [title, listedPath, mergedPath] = process.argv.slice(2);
const read = async (path) => testsIn(JSON.parse(await readFile(path, "utf8")));
const listed = await read(listedPath);
const ran = await read(mergedPath);
const text = summary({ title, listed, ran });

process.stdout.write(text);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
process.exitCode = problemsOf({ listed, ran }).length === 0 ? 0 : 1;
