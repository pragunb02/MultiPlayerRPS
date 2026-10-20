// Runs the design contract's CSS token check over the web app's CSS (CC-314). Part of `npm run lint`.
// The rules live in scripts/design/cssTokens.mjs, where they are unit tested.
import { fileURLToPath } from "node:url";
import { checkCssFiles } from "./design/cssTokens.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// It reports through the console like ESLint does.
// eslint-disable-next-line no-console
const problems = checkCssFiles({ root, log: (line) => console.error(line) });
if (problems > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `\n${problems} CSS token problem${problems === 1 ? "" : "s"} (docs/design/CONTRACT.md, the design contract).`,
  );
  process.exitCode = 1;
}
