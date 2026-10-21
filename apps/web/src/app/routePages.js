import { matchRoutes } from "react-router";
import { lazyRoute } from "./lazyRoute.jsx";
import { CONSOLE_ROUTES } from "../pages/AdminPage/consolePages.js";
import { LEGACY_ROUTES, ROUTES } from "./paths.js";

// Every page but home downloads on demand (CC-322). Home and the shell around every page stay in the first download,
// because home is the first page most players see.
export const PlayPage = lazyRoute(() => import("../pages/PlayPage/PlayPage.jsx"), "PlayPage");
export const RoomPage = lazyRoute(() => import("../pages/RoomPage/RoomPage.jsx"), "RoomPage");
export const PassAndPlayPage = lazyRoute(
  () => import("../pages/PassAndPlayPage/PassAndPlayPage.jsx"),
  "PassAndPlayPage",
);
export const LoginPage = lazyRoute(() => import("../pages/LoginPage/LoginPage.jsx"), "LoginPage");
export const SignupPage = lazyRoute(() => import("../pages/SignupPage/SignupPage.jsx"), "SignupPage");
export const ProfilePage = lazyRoute(() => import("../pages/ProfilePage/ProfilePage.jsx"), "ProfilePage");
export const PublicProfilePage = lazyRoute(
  () => import("../pages/PublicProfilePage/PublicProfilePage.jsx"),
  "PublicProfilePage",
);
export const ChallengePage = lazyRoute(
  () => import("../pages/ChallengePage/ChallengePage.jsx"),
  "ChallengePage",
);
export const FriendsPage = lazyRoute(() => import("../pages/FriendsPage/FriendsPage.jsx"), "FriendsPage");
export const FriendLinkPage = lazyRoute(
  () => import("../pages/FriendLinkPage/FriendLinkPage.jsx"),
  "FriendLinkPage",
);
export const DailyPuzzlePage = lazyRoute(
  () => import("../pages/DailyPuzzlePage/DailyPuzzlePage.jsx"),
  "DailyPuzzlePage",
);
export const LeaderboardPage = lazyRoute(
  () => import("../pages/LeaderboardPage/LeaderboardPage.jsx"),
  "LeaderboardPage",
);
export const PrivacyPage = lazyRoute(() => import("../pages/LegalPages/PrivacyPage.jsx"), "PrivacyPage");
export const TermsPage = lazyRoute(() => import("../pages/LegalPages/TermsPage.jsx"), "TermsPage");
export const NotFoundPage = lazyRoute(() => import("../pages/NotFoundPage/NotFoundPage.jsx"), "NotFoundPage");
export const AdminRoute = lazyRoute(() => import("../pages/AdminPage/AdminRoute.jsx"), "AdminRoute");

/** Home's address. It is in the first download, so there is nothing to fetch for it. */
const HOME = Object.freeze({ path: "/", page: null });

/**
 * Each address pattern of a page that downloads on demand, with its page, as `App.jsx` routes them. Any other
 * address but home's is the not-found page.
 */
export const LAZY_ROUTES = Object.freeze([
  HOME,
  ...[
    [ROUTES.GAME, PlayPage],
    [ROUTES.ROOM, RoomPage],
    [ROUTES.PASS_AND_PLAY, PassAndPlayPage],
    [ROUTES.LOGIN, LoginPage],
    [ROUTES.SIGNUP, SignupPage],
    [ROUTES.PROFILE, ProfilePage],
    [ROUTES.PLAYER, PublicProfilePage],
    [ROUTES.CHALLENGE, ChallengePage],
    [ROUTES.FRIENDS, FriendsPage],
    [ROUTES.FRIEND_LINK, FriendLinkPage],
    [ROUTES.DAILY, DailyPuzzlePage],
    [ROUTES.LEADERBOARD, LeaderboardPage],
    [ROUTES.PRIVACY, PrivacyPage],
    [ROUTES.TERMS, TermsPage],
    [LEGACY_ROUTES.GAME, PlayPage],
    [LEGACY_ROUTES.ROOM, RoomPage],
    ...CONSOLE_ROUTES.map(({ path }) => [path, AdminRoute]),
    ["*", NotFoundPage],
  ].map(([path, page]) => Object.freeze({ path, page })),
]);

/**
 * Starts downloading the page at an address, when it is one that downloads on demand. The router's own ranking
 * picks the page, so `/games/chess/rooms/AB2CD3` is the room and not the lobby, and an unknown address fetches
 * the not-found page. A failed download is left for the page to retry when it opens.
 *
 * @param {string} pathname  an address in the app, such as `/games/chess`
 * @returns {Promise<void>} settles once the page's code is here, at once for any other address
 */
export function preloadRouteFor(pathname) {
  const { page } = matchRoutes(LAZY_ROUTES, pathname)[0].route;
  if (page === null) {
    return Promise.resolve();
  }
  return page.preload().then(
    () => undefined,
    () => undefined,
  );
}
