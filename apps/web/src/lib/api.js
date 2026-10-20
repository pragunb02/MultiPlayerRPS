import { AppRequestError, networkError } from "./errors.js";

/**
 * The HTTP API client — the only place the web app calls `fetch`. Same-origin requests carry the session
 * cookie automatically; errors become AppRequestError with the server's code.
 *
 * @param {{ fetchImpl?: typeof fetch, baseUrl?: string }} [options]  injectable for tests
 */
export function createApiClient({ fetchImpl = (...args) => fetch(...args), baseUrl = "" } = {}) {
  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/api${path}`, {
        method,
        credentials: "same-origin",
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw networkError(err);
    }
    if (res.status === 204) {
      return {};
    }
    let payload;
    try {
      payload = await res.json();
    } catch (err) {
      // A success whose answer never fully arrived is a failed request, not an empty answer. WebKit cuts the
      // answer off when the player leaves the page while it is still arriving, and an empty answer made the
      // page read data that was not there (CC-184).
      if (res.ok) {
        throw networkError(err);
      }
      payload = {};
    }
    if (!res.ok) {
      throw new AppRequestError({
        ...(payload.error ?? { code: "UNKNOWN", message: "Something went wrong" }),
        status: res.status,
      });
    }
    return payload;
  }

  return Object.freeze({
    getGames: async () => (await request("GET", "/games")).games,
    /** @returns {Promise<object | undefined>} the session's identity, or undefined before the first visit has one */
    getSession: async () => {
      const body = await request("GET", "/session");
      return body.authenticated ? body.identity : undefined;
    },
    startGuest: async () => (await request("POST", "/session/guest")).identity,
    endSession: () => request("DELETE", "/session"),
    /**
     * Signing up or logging in answers who you are now and — when you were a guest with games — what your guest
     * progress brought along (CC-032).
     * @returns {Promise<{ identity: object, carriedOver?: { xp: number, matchesPlayed: number, matches: number } }>}
     */
    signup: async (credentials) => signedIn(await request("POST", "/auth/signup", credentials)),
    /** @returns {Promise<{ identity: object, carriedOver?: { xp: number, matchesPlayed: number, matches: number } }>} */
    login: async (credentials) => signedIn(await request("POST", "/auth/login", credentials)),
    /**
     * Changes the password. This browser stays signed in and every other one is signed out (CC-116).
     * @param {{ currentPassword: string, newPassword: string }} passwords
     */
    changePassword: async (passwords) => {
      await request("POST", "/auth/password", passwords);
    },
    /** Signs out every other browser of this account. This one stays signed in (CC-116). */
    signOutOtherDevices: async () => {
      await request("POST", "/auth/sign-out-others");
    },
    /**
     * The signed-in player's own account: username, when it was made, the birth year if stated, and the age group
     * it gives (CC-152).
     */
    getAccount: async () => (await request("GET", "/account")).account,
    /** Sets a birth year the account does not have yet. Answers the account. */
    setBirthYear: async (birthYear) => (await request("PUT", "/account/birth-year", { birthYear })).account,
    /**
     * The player's own safety flags from the age policy (CC-152): what the features in the browser may do for
     * them, such as whether a share card may carry their name. Never their age.
     */
    getSafety: async () => (await request("GET", "/safety")).safety,
    /**
     * The owner's correction of a player's birth year, on a request the owner checked (CC-152, ADR-048.9).
     *
     * @param {{ email: string, birthYear: number | null }} correction  null clears the year
     */
    correctBirthYear: async (correction) =>
      (await request("PUT", "/admin/accounts/birth-year", correction)).account,
    /** Everything ClassiCade holds about the account, as JSON, after the password is given again (CC-035). */
    exportData: (password) => request("POST", "/account/export", { password }),
    /** Deletes the account and everything linked to it. This browser is signed out (CC-035). */
    deleteAccount: async (password) => {
      await request("POST", "/account/delete", { password });
    },
    /** The players this player blocked, newest first: `{ blockId, displayName, blockedAt }` each (CC-044). */
    getBlocks: async () => (await request("GET", "/blocks")).blocks,
    /**
     * Blocks the player in a seat of a room both sit in (CC-044). The server never takes a player id.
     *
     * @param {{ roomCode: string, seat: number, seatId: string }} target
     */
    blockPlayer: async (target) => (await request("POST", "/blocks", target)).block,
    /** Removes one of this player's blocks (CC-044). */
    unblockPlayer: async (blockId) => {
      await request("DELETE", `/blocks/${encodeURIComponent(blockId)}`);
    },
    /** The player's own profile: handle, avatar, visibility and whether it may be public (CC-034). */
    getOwnProfile: async () => (await request("GET", "/profile")).profile,
    /** @param {string} avatar  an id from `AVATARS` */
    setAvatar: async (avatar) => (await request("PUT", "/profile/avatar", { avatar })).profile,
    /** @param {"public" | "private"} visibility */
    setProfileVisibility: async (visibility) =>
      (await request("PUT", "/profile/visibility", { visibility })).profile,
    /** What this viewer may see of the profile at a handle (CC-034). Unknown and blocked are both NOT_FOUND. */
    getPlayerProfile: async (handle) =>
      (await request("GET", `/profiles/${encodeURIComponent(handle)}`)).player,
    getProgress: async () => (await request("GET", "/progress")).progress,
    getMatches: (query = {}) => request("GET", `/matches${toQuery(query)}`),
    getMatch: async (matchId) => (await request("GET", `/matches/${encodeURIComponent(matchId)}`)).match,
    /** The whole achievement catalog with your progress and unlock times (CC-054). */
    getAchievements: async () => (await request("GET", "/achievements")).achievements,
    /** Your win streak and daily play streak (CC-054). */
    getStreaks: async () => (await request("GET", "/streaks")).streaks,
    /** Today's quests (UTC day), the sweep bonus and when they reset (CC-089). */
    getQuests: async () => (await request("GET", "/quests")).quests,
    /** Today's daily puzzle of a kind, with your attempt and streak once you have a session (CC-144). */
    getDailyPuzzle: async (kind) => (await request("GET", `/daily/${encodeURIComponent(kind)}`)).puzzle,
    /**
     * Plays a move in today's puzzle.
     * @param {string} kind
     * @param {{ day: string, from: string, to: string, promotion?: string }} move
     * @returns {Promise<{ outcome: string, played: { san: string }, reply?: { from: string, to: string, san: string }, puzzle: object }>}
     */
    playDailyMove: (kind, move) => request("POST", `/daily/${encodeURIComponent(kind)}/moves`, move),
    /**
     * Takes the next hint for the move you are looking for.
     * @param {string} kind
     * @param {{ day: string }} body
     * @returns {Promise<{ hint: string, puzzle: object }>}
     */
    takeDailyHint: (kind, body) => request("POST", `/daily/${encodeURIComponent(kind)}/hints`, body),
    getLeaderboards: async () => (await request("GET", "/leaderboards")).boards,
    /** @returns {Promise<{ board: object, entries: object[], you?: object }>} */
    getLeaderboard: (boardId, query = {}) =>
      request("GET", `/leaderboards/${encodeURIComponent(boardId)}${toQuery(query)}`),
    /**
     * Whether this session may open the owner console (CC-233). The server says so only to an admin, so for
     * everyone else nothing on the page or in the answer mentions a console.
     *
     * @returns {Promise<boolean>}
     */
    getAdminStatus: async () => (await request("GET", "/session")).admin === true,
    /**
     * The owner console's report for a range (CC-233). Without one, the last 30 days.
     *
     * @param {{ from?: string, to?: string, bucket?: string }} [range]
     */
    getAnalytics: async (range = {}) => (await request("GET", `/admin/analytics${toQuery(range)}`)).report,
    /**
     * Sends one item of feedback (CC-290). The server works out who sent it from the session.
     *
     * @param {{ type: string, message: string, page: string, build: string, device: string, replyEmail?: string }} feedback
     */
    sendFeedback: async (feedback) => (await request("POST", "/feedback", feedback)).feedback,
    /** @returns {Promise<{ replyEmail: boolean }>} whether the feedback form may offer an email reply */
    getFeedbackForm: async () => (await request("GET", "/feedback/form")).form,
    /**
     * The owner console's feedback inbox, newest first, 50 at a time (CC-290).
     *
     * @param {{ type?: string, status?: string, before?: string }} [query]  `before` is the `next` of the page before
     * @returns {Promise<{ items: object[], next?: string }>}
     */
    getFeedbackInbox: (query = {}) => request("GET", `/admin/feedback${toQuery(query)}`),
    /** One item of the inbox with everything, the reply email included, for its own view (CC-290). */
    getFeedbackItem: async (feedbackId) =>
      (await request("GET", `/admin/feedback/${encodeURIComponent(feedbackId)}`)).item,
    /** Deletes one item of the inbox for good (CC-290). */
    deleteFeedback: async (feedbackId) => {
      await request("DELETE", `/admin/feedback/${encodeURIComponent(feedbackId)}`);
    },
    /** Moves one item of the inbox to another status, and answers it as it is now (CC-290). */
    setFeedbackStatus: async (feedbackId, status) =>
      (await request("PATCH", `/admin/feedback/${encodeURIComponent(feedbackId)}`, { status })).item,
  });
}

const signedIn = ({ identity, carriedOver }) => ({
  identity,
  ...(carriedOver !== undefined && { carriedOver }),
});

function toQuery(query) {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
