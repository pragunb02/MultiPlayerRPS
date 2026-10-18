import { useCallback, useState } from "react";
import { AnnounceContext } from "./announceContext.js";

/**
 * The match's two screen reader regions (docs/ux/MATCH_EXPERIENCE.md, section 2 item 8): one polite, for news
 * that can wait until the reader is done, and one urgent, which the shell keeps for the result. Parts of the match
 * read the polite one through `useAnnounce`, so a game needs no live region of its own. Saying the same words
 * twice in a row is read twice, because each message is a new element.
 *
 * @param {{ urgent: string, children: import("react").ReactNode }} props  `urgent`: what the urgent region says
 *   now, empty for nothing
 */
export function MatchAnnouncer({ urgent, children }) {
  const [polite, setPolite] = useState({ text: "", count: 0 });
  const announce = useCallback((text) => setPolite((last) => ({ text, count: last.count + 1 })), []);
  return (
    <AnnounceContext value={announce}>
      {children}
      <div className="visually-hidden" data-cc-slot="announcer">
        <p aria-live="polite">{polite.text !== "" && <span key={polite.count}>{polite.text}</span>}</p>
        <p aria-live="assertive">{urgent}</p>
      </div>
    </AnnounceContext>
  );
}
