import { createMatchPlayerIds } from "../domain/matches/matchPlayerIds.js";

/**
 * Real match player ids under a key for tests only (CC-297). Tests that read match history work out the id they
 * expect with `playerIdIn`, the same way the match component does.
 */
export const TEST_MATCH_PLAYER_IDS = createMatchPlayerIds({
  secret: "match-secret-for-tests-only-0123456789abcdef",
});
