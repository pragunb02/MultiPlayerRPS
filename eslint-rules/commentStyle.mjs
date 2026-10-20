import { PROBLEMS, checkComment } from "./commentCheck.mjs";
import { popupContractRule } from "./popupContract.mjs";

/**
 * The `classicade/comment-style` rule. It reads every comment in a file and reports each place that breaks the
 * comment style rule in docs/ENGINEERING.md. It has no autofix, because rewording a sentence needs a person.
 * @type {import("eslint").Rule.RuleModule}
 */
export const commentStyleRule = Object.freeze({
  meta: {
    type: "suggestion",
    docs: {
      description: "Comments are plain prose for a new teammate (docs/ENGINEERING.md, comment style).",
    },
    schema: [],
    messages: { ...PROBLEMS, jargon: `"{{ found }}" is jargon or shorthand. ${PROBLEMS.jargon}` },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          // The comment text starts after the two marker characters, `//` or `/*`.
          const textStart = comment.range[0] + 2;
          for (const problem of checkComment(comment.value, { block: comment.type === "Block" })) {
            const start = sourceCode.getLocFromIndex(textStart + problem.index);
            const end = sourceCode.getLocFromIndex(textStart + problem.index + problem.found.length);
            context.report({ loc: { start, end }, messageId: problem.id, data: { found: problem.found } });
          }
        }
      },
    };
  },
});

/** The local ESLint plugin, registered as `classicade` in eslint.config.js. */
export const classicadePlugin = Object.freeze({
  meta: { name: "classicade" },
  rules: { "comment-style": commentStyleRule, "popup-contract": popupContractRule },
});
