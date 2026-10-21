import { matchRoutes } from "react-router";
import { CONSOLE_ROUTES } from "../pages/AdminPage/consolePages.js";
import { HomePage } from "../pages/HomePage/HomePage.jsx";
import { lazyRoute } from "./lazyRoute.jsx";
import { LEGACY_ROUTES, paths, ROUTES } from "./paths.js";

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

/**
 * Every route of the app, in one table that both `App.jsx` (to draw the page) and `preloadRouteFor` (to fetch it
 * early) read, so the two can never disagree (CC-322). An entry has a `page` and the `props` it gets, or a
 * `redirect` to the address that replaces it. Order does not matter: the router ranks the paths itself.
 *
 * @type {ReadonlyArray<Readonly<{ path?: string, index?: true, page?: import("react").ComponentType<any>,
 *   props?: object, redirect?: () => string }>>}
 */
export const APP_ROUTES = Object.freeze(
  [
    { index: true, page: HomePage },
    { path: ROUTES.GAME, page: PlayPage },
    { path: ROUTES.ROOM, page: RoomPage },
    { path: ROUTES.PASS_AND_PLAY, page: PassAndPlayPage },
    { path: ROUTES.LOGIN, page: LoginPage },
    { path: ROUTES.SIGNUP, page: SignupPage },
    { path: ROUTES.PROFILE, page: ProfilePage },
    { path: ROUTES.PLAYER, page: PublicProfilePage },
    { path: ROUTES.CHALLENGE, page: ChallengePage },
    { path: ROUTES.FRIENDS, page: FriendsPage },
    { path: ROUTES.FRIEND_LINK, page: FriendLinkPage },
    { path: ROUTES.DAILY, page: DailyPuzzlePage },
    { path: ROUTES.LEADERBOARD, page: LeaderboardPage },
    { path: ROUTES.LEADERBOARDS, redirect: () => paths.leaderboards() },
    { path: ROUTES.PRIVACY, page: PrivacyPage },
    { path: ROUTES.TERMS, page: TermsPage },
    ...CONSOLE_ROUTES.map(({ path, view }) => ({ path, page: AdminRoute, props: { view } })),
    // Old URLs stay valid: each page replaces them with its canonical URL.
    { path: LEGACY_ROUTES.GAME, page: PlayPage },
    { path: LEGACY_ROUTES.ROOM, page: RoomPage },
    { path: LEGACY_ROUTES.PROFILE, redirect: () => paths.profile() },
    { path: LEGACY_ROUTES.AUTH, redirect: () => paths.login() },
    { path: "*", page: NotFoundPage },
  ].map((route) => Object.freeze(route)),
);

/**
 * The page an address shows, by the router's own ranking, so `/games/chess/rooms/AB2CD3` is the room and not the
 * lobby. A redirect is followed to the page it lands on, and an unknown address is the not-found page.
 *
 * @param {string} pathname  an address in the app, such as `/games/chess`
 * @returns {import("react").ComponentType<any> & { preload?: () => Promise<unknown>, prefetch?: () => void }}
 */
export function pageFor(pathname) {
  const { route } = matchRoutes(APP_ROUTES, pathname)[0];
  return route.redirect ? pageFor(new URL(route.redirect(), "https://app.invalid").pathname) : route.page;
}

/**
 * Downloads and runs the code of the page at an address before it is drawn, when it is one that downloads on demand
 * (`main.jsx`, on a direct visit). A failed download is left for the page to retry when it opens.
 *
 * @param {string} pathname
 * @returns {Promise<void>} settles once the page's code is here, at once for home
 */
export function preloadRouteFor(pathname) {
  const page = pageFor(pathname);
  if (page.preload === undefined) {
    return Promise.resolve();
  }
  return page.preload().then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Hints the browser to fetch the files of the page at an address, running nothing (`routePrefetch.js`). If they
 * fail, nothing happens.
 *
 * @param {string} pathname
 */
export function prefetchRouteFor(pathname) {
  pageFor(pathname).prefetch?.();
}
