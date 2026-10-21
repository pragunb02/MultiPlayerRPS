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
     * Blocks the player in a seat of a room both sit in or of a match both played, or the player of one of this
     * player's reports (CC-044, ADR-071.4). The server never takes a player id.
     *
     * @param {{ roomCode: string, seat: number, seatId: string } | { matchId: string, seat: number } | { reportId: string }} target
     */
    blockPlayer: async (target) => (await request("POST", "/blocks", target)).block,
    /** Removes one of this player's blocks (CC-044). */
    unblockPlayer: async (blockId) => {
      await request("DELETE", `/blocks/${encodeURIComponent(blockId)}`);
    },
    /**
     * Reports a player by where the two met, with a closed reason and nothing else (CC-044, ADR-071). The answer
     * is the same every time: the report's id, for the one-tap block, and its time.
     *
     * @param {({ roomCode: string, seat: number, seatId: string } | { matchId: string, seat: number } | { handle: string }) & { reason: string }} report
     * @returns {Promise<{ reportId: string, createdAt: number }>}
     */
    reportPlayer: async (report) => (await request("POST", "/reports", report)).report,
    /**
     * One page of the owner console's report queue, grouped by reported player (CC-044).
     *
     * @param {{ status?: string, page?: string }} [query]
     * @returns {Promise<{ groups: object[], total: number, page: number, more: boolean }>}
     */
    getReportQueue: (query = {}) => request("GET", `/admin/reports${toQuery(query)}`),
    /** Dismisses the reports of one group, or renames its account to a safe default (CC-044). */
    actOnReports: async (reportId, action) =>
      (await request("POST", `/admin/reports/${encodeURIComponent(reportId)}/actions`, { action })).result,
    /**
     * Suspends the account a report group is about, for a duration and a closed reason (CC-334, ADR-078).
     *
     * @param {string} reportId  the group's id, its newest report
     * @param {{ duration: string, reason: string }} suspension
     * @returns {Promise<{ suspension: object, closed: number }>}
     */
    suspendAccount: (reportId, suspension) =>
      request("POST", `/admin/reports/${encodeURIComponent(reportId)}/suspension`, suspension),
    /** The suspensions of the account a report group is about, newest first (CC-334). */
    getSuspensionHistory: async (reportId) =>
      (await request("GET", `/admin/reports/${encodeURIComponent(reportId)}/suspensions`)).suspensions,
    /** The suspensions in effect now (CC-334). */
    getCurrentSuspensions: async () => (await request("GET", "/admin/suspensions")).suspensions,
    /** Lifts a suspension early (CC-334). */
    liftSuspension: async (suspensionId) =>
      (await request("POST", `/admin/suspensions/${encodeURIComponent(suspensionId)}/lift`)).suspension,
    /** A suspended account's data, with its email and password: it has no session (CC-334, ADR-078). */
    exportSuspendedData: (credentials) => request("POST", "/auth/suspended-export", credentials),
    /**
     * The player's friends view (CC-052): friends with their presence, the requests waiting for them and the ones
     * they sent, their Appear offline switch, and whether to show safety tips. A guest is refused with FORBIDDEN.
     */
    getFriends: () => request("GET", "/friends"),
    /**
     * Asks someone the player played with to be friends, by their seat in a room or a match. Never by player id.
     *
     * @param {{ roomCode: string, seat: number, seatId: string } | { matchId: string, seat: number }} target
     * @returns {Promise<"sent" | "friends">}
     */
    sendFriendRequest: async (target) => (await request("POST", "/friends/requests", target)).result,
    /**
     * @param {string} requestId
     * @param {"accept" | "decline"} answer
     * @returns {Promise<"friends" | "declined">}
     */
    answerFriendRequest: async (requestId, answer) =>
      (await request("POST", `/friends/requests/${encodeURIComponent(requestId)}/answer`, { answer })).result,
    /** Takes back a request the player sent. */
    cancelFriendRequest: async (requestId) => {
      await request("DELETE", `/friends/requests/${encodeURIComponent(requestId)}`);
    },
    /** Removes a friend, by their profile handle. */
    removeFriend: async (handle) => {
      await request("DELETE", `/friends/${encodeURIComponent(handle)}`);
    },
    /** @param {boolean} appearOffline @returns {Promise<{ appearOffline: boolean }>} */
    setAppearOffline: async (appearOffline) =>
      (await request("PUT", "/friends/settings", { appearOffline })).settings,
    /** A new one-use friend link: `{ token, expiresAt }`. The token is shown once. */
    makeFriendLink: async () => (await request("POST", "/friends/links")).link,
    /** What a friend link's page shows: `{ displayName, avatar?, own? }`. Reading it never uses the link up. */
    getFriendLink: async (token) =>
      (await request("GET", `/friends/links/${encodeURIComponent(token)}`)).invite,
    /** Uses a friend link: its maker gets a request. @returns {Promise<"sent" | "friends">} */
    useFriendLink: async (token) =>
      (await request("POST", `/friends/links/${encodeURIComponent(token)}`)).result,
    /**
     * Makes a challenge for a game and its options, open for a day (CC-139). Answers the creator's view of it.
     * @param {{ gameId: string, options: object }} challenge
     */
    createChallenge: async (challenge) => (await request("POST", "/challenges", challenge)).challenge,
    /** What this viewer may see of a challenge, for its page. Visitors too (CC-139). */
    getChallenge: async (id) => (await request("GET", `/challenges/${encodeURIComponent(id)}`)).challenge,
    /** The player's inbox: their open and taken challenges, and the ones sent to them (CC-139, CC-207). */
    getChallenges: async () => (await request("GET", "/challenges")).challenges,
    /**
     * Takes a challenge. Answers `{ challenge, room: { code, gameId } }`, the room made for both players.
     * @param {string} id
     */
    acceptChallenge: (id) => request("POST", `/challenges/${encodeURIComponent(id)}/accept`),
    /** Says no to a challenge sent to this player. Answers the challenge. */
    declineChallenge: async (id) =>
      (await request("POST", `/challenges/${encodeURIComponent(id)}/decline`)).challenge,
    /** Takes back this player's own open challenge. Answers the challenge. */
    withdrawChallenge: async (id) =>
      (await request("POST", `/challenges/${encodeURIComponent(id)}/withdraw`)).challenge,
    /** Moves a challenge from a popup to this player's inbox, on every tab (CC-207). Answers the challenge. */
    challengeLater: async (id) =>
      (await request("POST", `/challenges/${encodeURIComponent(id)}/later`)).challenge,
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
    /**
     * Whether each of these feature flags is on for this player (CC-312). Only booleans come back.
     *
     * @param {ReadonlyArray<string>} names  client flags from packages/shared/src/flags.js
     * @returns {Promise<Record<string, boolean>>}
     */
    getFlags: async (names) =>
      (await request("GET", `/flags?names=${names.map(encodeURIComponent).join(",")}`)).flags,
    /** Counts the success event of a flag once, on the side the server works out for this player (CC-312). */
    sendFlagSuccess: async (name) => {
      await request("POST", `/flags/${encodeURIComponent(name)}/success`);
    },
    /** The owner console's flags with their rollouts and counts (CC-312). */
    getAdminFlags: () => request("GET", "/admin/flags"),
    /** Sets a flag's rollout from the console, and answers the flag as it is now (CC-312). */
    setFlagRollout: async (name, rollout) =>
      (await request("PUT", `/admin/flags/${encodeURIComponent(name)}`, { rollout })).flag,
    /** Sends a flag back to the rollout in code, and answers the flag as it is now (CC-312). */
    clearFlagRollout: async (name) =>
      (await request("DELETE", `/admin/flags/${encodeURIComponent(name)}`)).flag,
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
