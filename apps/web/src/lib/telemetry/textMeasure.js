import { bucketOf, TELEMETRY_BUCKETS } from "@classicade/shared";

/** The lower ends of the word buckets after the first (CC-313 section 3). */
const WORD_EDGES = Object.freeze([51, 101, 201, 401]);
const WORD = /\S+/g;

/**
 * How many words of an element a person can see: all of them, and those above the fold. Hidden text (the
 * `hidden` attribute, `display: none`, `visibility: hidden`, `aria-hidden`) does not count. Every visible word
 * counts, Hinglish and English lines alike, because the player has to read both (CC-313 rabbit holes).
 *
 * @param {Element} root  usually `main`
 * @param {{ view: Pick<Window, "getComputedStyle" | "innerHeight">, document: Document }} deps
 * @returns {{ words: number, foldWords: number }}
 */
export function countWords(root, { view, document }) {
  const hidden = new Map();
  const isHidden = (element) => {
    if (element === null || element === root.parentElement) return false;
    if (hidden.has(element)) return hidden.get(element);
    const style = view.getComputedStyle(element);
    const own =
      element.hidden ||
      element.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden";
    const answer = own || isHidden(element.parentElement);
    hidden.set(element, answer);
    return answer;
  };
  const walker = document.createTreeWalker(root, 4);
  const range = document.createRange();
  let words = 0;
  let foldWords = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const count = (node.textContent ?? "").match(WORD)?.length ?? 0;
    if (count === 0 || isHidden(node.parentElement)) continue;
    words += count;
    range.selectNodeContents(node);
    // A browser without layout (a test's) puts everything above the fold.
    const top = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect().top : 0;
    if (top < view.innerHeight) foldWords += count;
  }
  return { words, foldWords };
}

/**
 * The word buckets of a screen: never a word, only how many.
 *
 * @param {{ words: number, foldWords: number }} counted
 * @returns {{ words: string, fold_words: string }}
 */
export const wordBuckets = ({ words, foldWords }) => ({
  words: bucketOf(words, WORD_EDGES, TELEMETRY_BUCKETS.WORDS),
  fold_words: bucketOf(foldWords, WORD_EDGES, TELEMETRY_BUCKETS.WORDS),
});
