import { useCallback, useEffect, useState } from "react";
import { useServices } from "../app/servicesContext.js";

const PAGE_SIZE = 10;

/**
 * Match history, newest first, with "load more" paging. status: "loading" | "ready" | "error" (first page).
 * A failed "load more" keeps the list and reports `moreError`, so the player can try again.
 */
export function useMatchHistory() {
  const { api } = useServices();
  const [state, setState] = useState({
    status: "loading",
    matches: [],
    nextBefore: undefined,
    error: undefined,
    moreError: undefined,
  });

  const apply = useCallback(
    (page, previous) =>
      setState({
        status: "ready",
        matches: [...previous, ...page.matches],
        nextBefore: page.nextBefore,
        error: undefined,
        moreError: undefined,
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    api.getMatches({ limit: PAGE_SIZE }).then(
      (page) => !cancelled && apply(page, []),
      (error) => !cancelled && setState((s) => ({ ...s, status: "error", error })),
    );
    return () => {
      cancelled = true;
    };
  }, [api, apply]);

  const loadMore = useCallback(async () => {
    try {
      const page = await api.getMatches({ limit: PAGE_SIZE, before: state.nextBefore });
      apply(page, state.matches);
    } catch (moreError) {
      setState((s) => ({ ...s, moreError }));
    }
  }, [api, apply, state.matches, state.nextBefore]);

  return { ...state, hasMore: state.nextBefore !== undefined, loadMore };
}
