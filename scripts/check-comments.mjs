// Runs the comment style rule over CSS files, which ESLint does not read. Part of `npm run lint`.
// The checks themselves live in eslint-rules/cssComments.mjs, where they are unit tested.
import { fileURLToPath } from "node:url";
import { checkCssFiles } from "../eslint-rules/cssComments.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The rule is about wording, so it reports through the console like ESLint does.
// eslint-disable-next-line no-console
const problems = checkCssFiles({ root, log: (line) => console.error(line) });
if (problems > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `\n${problems} CSS comment problem${problems === 1 ? "" : "s"} (docs/ENGINEERING.md, comment style).`,
  );
  process.exitCode = 1;
}
