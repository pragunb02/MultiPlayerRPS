// The owner of the site and a week of history for the owner console's browser tests (CC-233). server.mjs puts
// both into the test database before the app starts, and app.mjs lists the owner in ADMIN_ACCOUNT_IDS. The week
// is in March 2025, long before anything the other tests play, so its totals never change.
import { matchDoc, playerId, transferDoc } from "../apps/server/src/testing/analyticsFixtures.js";

/** The owner's account, seeded with this fixed id so the app can be told it is an admin. */
export const OWNER = Object.freeze({
  accountId: "65f0c2a1b2c3d4e5f6a7b8c9",
  username: "Site_Owner",
  email: "owner@example.com",
  password: "owner password for e2e 1",
});
export const OWNER_PLAYER_ID = `user_${OWNER.accountId}`;

/** The seeded week, Monday to Sunday in India time, and what the console must show for it. */
export const SEEDED_WEEK = Object.freeze({ from: "2025-03-03", to: "2025-03-09" });
export const SEEDED_TOTALS = Object.freeze({
  activePlayers: "16",
  matches: "21",
  newPlayers: "16",
  weeklyReturning: "10",
  matchesPerPlayer: "2.63",
  guestsConverted: "5",
  conversionRate: "33.3%",
});

/**
 * The week: 10 guests in 5 pairs play Rock Paper Scissors on Monday, Wednesday and Friday evenings. 6 accounts
 * in 3 pairs play chess on Tuesday and Tic Tac Toe on Thursday. 5 other guests save their progress on Thursday.
 */
export function seededWeek() {
  const guests = Array.from({ length: 10 }, (_, index) => playerId("guest", 500 + index));
  const accounts = Array.from({ length: 6 }, (_, index) => playerId("user", 500 + index));
  const pairs = (ids) =>
    Array.from({ length: ids.length / 2 }, (_, index) => [ids[2 * index], ids[2 * index + 1]]);
  // 14:30 UTC is 20:00 in India.
  const at = (day) => `${day}T14:30:00.000Z`;
  const matches = [
    ...["2025-03-03", "2025-03-05", "2025-03-07"].flatMap((day) =>
      pairs(guests).map((pair) =>
        matchDoc({ gameId: "rps", playerIds: pair, endedAt: at(day), seconds: 45 }),
      ),
    ),
    ...pairs(accounts).map((pair) =>
      matchDoc({ gameId: "chess", playerIds: pair, endedAt: at("2025-03-04"), seconds: 600 }),
    ),
    ...pairs(accounts).map((pair) =>
      matchDoc({ gameId: "tictactoe", playerIds: pair, endedAt: at("2025-03-06"), seconds: 30 }),
    ),
  ];
  const transfers = Array.from({ length: 5 }, (_, number) =>
    transferDoc({ number: 500 + number, createdAt: at("2025-03-06"), matches: 2 }),
  );
  return { matches, transfers };
}
