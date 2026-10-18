import { DAILY_SWEEP_BONUS_XP } from "@classicade/shared";
import { earnsNothing } from "../../models/deletedPlayer.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { creditFor, hasComputerPlayer } from "../matches/fairPlay.js";
import { resultFor } from "../progression/progressionComponent.js";
import { nextUtcMidnight, utcDay } from "./calendar.js";
import { achievementStanding, evaluateAchievements } from "./evaluateAchievements.js";
import { applyMatchToQuests, newQuestDay } from "./questProgress.js";
import { applyMatchToStats, emptyStats } from "./stats.js";
import { dailyStreakView } from "./streaks.js";

/** Events the gamification component publishes (the gateway pushes each to the player concerned). */
export const GAMIFICATION_EVENTS = Object.freeze({
  /** { playerId, achievements: Achievement[] } — newly unlocked only */
  ACHIEVEMENTS_UNLOCKED: "gamification.achievementsUnlocked",
  /** { playerId, quests: QuestsView } — today's quests moved on */
  QUESTS_UPDATED: "gamification.questsUpdated",
  /** { playerId, streaks: StreaksView } — after a counted match */
  STREAKS_UPDATED: "gamification.streaksUpdated",
});

const HISTORY_PAGE = 100;

/** The exactly-once key of a quest bonus (shared with progression's window, so never a match id). */
export const questKey = (day, questId) => `quest:${day}:${questId}`;
const SWEEP = "sweep";

/** @param {Readonly<import("./questProgress.js").QuestDay>} questDay @param {number} now */
function questsView(questDay, now) {
  return Object.freeze({
    day: questDay.day,
    resetsAt: nextUtcMidnight(now),
    items: questDay.items.map(({ id, name, description, gameId, target, progress, bonusXp, completedAt }) =>
      Object.freeze({ id, name, description, gameId, target, progress, bonusXp, completedAt }),
    ),
    sweep: Object.freeze({ bonusXp: DAILY_SWEEP_BONUS_XP, completedAt: questDay.sweepAt }),
  });
}

/** @param {Readonly<import("./stats.js").PlayerStats>} stats @param {number} now */
function streaksView(stats, now) {
  return Object.freeze({
    win: Object.freeze({ current: stats.winStreak.current, best: stats.winStreak.best }),
    daily: dailyStreakView(stats.dailyStreak, now),
  });
}

/** One catalog entry as the player sees it. */
function achievementView({ achievement, current, earned }, unlock) {
  const { id, name, description, icon, tier, target } = achievement;
  const unlocked = unlock !== undefined;
  return Object.freeze({
    id,
    name,
    description,
    icon,
    tier,
    unlockedAt: unlocked ? unlock.unlockedAt : null,
    // Unlocked stays unlocked, even if a rebuilt stat is lower now.
    progress: Object.freeze({ current: unlocked || earned ? target : current, target }),
  });
}

/**
 * Achievements, streaks and daily quests (CC-054, CC-089; rules in ADR-013). Fed from recorded matches after
 * progression; quest bonuses are awarded through progression, exactly once each.
 *
 * @param {{
 *   gamificationAccessor: ReturnType<typeof import("../../data/gamificationAccessor.js").createGamificationAccessor>,
 *   matchAccessor: Pick<ReturnType<typeof import("../../data/matchAccessor.js").createMatchAccessor>, "listForPlayer">,
 *   progressionComponent: Pick<ReturnType<typeof import("../progression/progressionComponent.js").createProgressionComponent>, "awardBonus" | "getProgress">,
 *   events: { emit: (event: string, payload: unknown) => void },
 * }} deps
 */
export function createGamificationComponent({
  gamificationAccessor,
  matchAccessor,
  progressionComponent,
  events,
}) {
  assertDefined(gamificationAccessor, "gamificationAccessor");
  assertFunction(matchAccessor?.listForPlayer, "matchAccessor.listForPlayer");
  assertFunction(progressionComponent?.awardBonus, "progressionComponent.awardBonus");
  assertFunction(progressionComponent?.getProgress, "progressionComponent.getProgress");
  assertFunction(events?.emit, "events.emit");

  const getStats = (playerId) => gamificationAccessor.getStats({ playerId, empty: emptyStats(playerId) });

  /** Unlocks what the player has earned and doesn't have yet; returns the new unlocks as views. */
  async function unlockEarned({ playerId, stats, at, matchId }) {
    const progress = await progressionComponent.getProgress(playerId);
    const have = new Set((await gamificationAccessor.listUnlocks(playerId)).map((u) => u.achievementId));
    const standing = achievementStanding(stats, progress);
    const unlocked = [];
    for (const achievementId of evaluateAchievements(stats, progress).filter((id) => !have.has(id))) {
      if (await gamificationAccessor.unlock({ playerId, achievementId, unlockedAt: at, matchId })) {
        const entry = standing.find((s) => s.achievement.id === achievementId);
        unlocked.push(achievementView(entry, { unlockedAt: at }));
      }
    }
    if (unlocked.length > 0) {
      events.emit(GAMIFICATION_EVENTS.ACHIEVEMENTS_UNLOCKED, { playerId, achievements: unlocked });
    }
    return unlocked;
  }

  /**
   * Bonus XP and the quest counter for every completed quest of the day. Each is idempotent by key, so this
   * also finishes what a crash interrupted last time.
   */
  async function rewardQuests({ playerId, displayName, questDay, at, stats: counted, computerGame }) {
    let stats = counted;
    // A bonus that this game against a computer character earned stays off the leaderboards (ADR-025).
    const unrankedAt = (completedAt) => computerGame && completedAt === at;
    for (const item of questDay.items.filter((i) => i.completedAt !== null)) {
      const key = questKey(questDay.day, item.id);
      await progressionComponent.awardBonus({
        playerId,
        displayName,
        key,
        xp: item.bonusXp,
        at: item.completedAt,
        unranked: unrankedAt(item.completedAt),
      });
      ({ stats } = await gamificationAccessor.applyToStatsOnce({
        playerId,
        key,
        at,
        empty: emptyStats(playerId),
        change: (s) => ({ ...s, questsCompleted: s.questsCompleted + 1 }),
      }));
    }
    if (questDay.sweepAt !== null) {
      await progressionComponent.awardBonus({
        playerId,
        displayName,
        key: questKey(questDay.day, SWEEP),
        xp: DAILY_SWEEP_BONUS_XP,
        at: questDay.sweepAt,
        unranked: unrankedAt(questDay.sweepAt),
      });
    }
    return stats;
  }

  async function applyForPlayer({ match, playerId, displayName, now }) {
    const result = resultFor(match, playerId);
    const at = match.endedAt;
    const day = utcDay(at);
    const counted = await gamificationAccessor.applyToStatsOnce({
      playerId,
      key: match.matchId,
      at,
      empty: emptyStats(playerId),
      change: (stats) =>
        applyMatchToStats(stats, { gameId: match.gameId, result, reason: match.result.reason, endedAt: at }),
    });
    const quests = await gamificationAccessor.applyToQuestDayOnce({
      playerId,
      day,
      key: match.matchId,
      create: () => newQuestDay({ playerId, day }),
      change: (questDay) => applyMatchToQuests(questDay, { gameId: match.gameId, result, at }),
    });
    const stats = await rewardQuests({
      playerId,
      displayName,
      questDay: quests.questDay,
      at,
      stats: counted.stats,
      computerGame: hasComputerPlayer(match),
    });

    if (counted.applied) {
      events.emit(GAMIFICATION_EVENTS.STREAKS_UPDATED, { playerId, streaks: streaksView(stats, now) });
    }
    // A late match from yesterday moved yesterday's quests: nothing on today's screen changed.
    if (quests.applied && day === utcDay(now)) {
      events.emit(GAMIFICATION_EVENTS.QUESTS_UPDATED, { playerId, quests: questsView(quests.questDay, now) });
    }
    await unlockEarned({ playerId, stats, at, matchId: match.matchId });
  }

  /** Every recorded match of a player, oldest first. */
  async function historyOf(playerId) {
    const matches = [];
    let before;
    for (;;) {
      const page = await matchAccessor.listForPlayer(playerId, { limit: HISTORY_PAGE, before });
      matches.push(...page);
      if (page.length < HISTORY_PAGE) {
        return matches.reverse();
      }
      before = page.at(-1).endedAt;
    }
  }

  return Object.freeze({
    /**
     * Counts a recorded match for each of its players (after progression applied it): stats and streaks,
     * quests and their bonus XP, then achievements. A player the match doesn't count for (CC-095) gets none of
     * it, and neither does a computer character (ADR-025) or a deleted player's stand-in (CC-035). Applying the same match again changes nothing.
     *
     * @param {{ match: Readonly<import("../../data/matchAccessor.js").Match>, now: number }} input
     */
    async applyMatch({ match, now }) {
      for (const { playerId, displayName } of match.players.filter(
        (p) => !earnsNothing(p.playerId) && creditFor(match, p.playerId).counted,
      )) {
        await applyForPlayer({ match, playerId, displayName, now });
      }
    },

    /**
     * The whole catalog, in order, with the player's progress and unlock time on each.
     *
     * @param {{ playerId: string }} query
     */
    async getAchievements({ playerId }) {
      const [stats, progress, unlocks] = await Promise.all([
        getStats(playerId),
        progressionComponent.getProgress(playerId),
        gamificationAccessor.listUnlocks(playerId),
      ]);
      return achievementStanding(stats, progress).map((entry) =>
        achievementView(
          entry,
          unlocks.find((u) => u.achievementId === entry.achievement.id),
        ),
      );
    },

    /** @param {{ playerId: string, now: number }} query */
    async getStreaks({ playerId, now }) {
      return streaksView(await getStats(playerId), now);
    },

    /**
     * Today's quests (UTC). The first look of the day stores the day's snapshot.
     *
     * @param {{ playerId: string, now: number }} query
     */
    async getQuests({ playerId, now }) {
      const day = utcDay(now);
      const questDay = await gamificationAccessor.getQuestDay({
        playerId,
        day,
        create: () => newQuestDay({ playerId, day }),
      });
      return questsView(questDay, now);
    },

    /**
     * A guest became an account (CC-032, ADR-014): unlocks move (earliest time wins), stats are rebuilt from the
     * account's match history (already moved, games that count only) plus both players' completed quests, the guest's quest days go
     * (their XP already moved with progress), and achievements are checked again. Idempotent and resumable.
     *
     * @param {{ from: string, to: { id: string }, now: number }} transfer
     * @returns {Promise<{ moved: Record<string, number> }>}
     */
    async transferPlayer({ from, to, now }) {
      const playerId = to.id;
      const achievements = await gamificationAccessor.moveUnlocks({ from, to: playerId });
      const guest = await getStats(from);
      const history = await historyOf(playerId);
      // Only the games that count for the account (CC-095), so merged stats stay within the fair play limits.
      const rebuilt = history
        .filter((match) => creditFor(match, playerId).counted)
        .reduce(
          (stats, match) =>
            applyMatchToStats(stats, {
              gameId: match.gameId,
              result: resultFor(match, playerId),
              reason: match.result.reason,
              endedAt: match.endedAt,
            }),
          emptyStats(playerId),
        );
      const stats = await gamificationAccessor.rewriteStats({
        playerId,
        at: now,
        empty: emptyStats(playerId),
        seenKeys: history.map((match) => match.matchId),
        change: (account) => {
          const merged = account.mergedFrom.includes(from);
          return {
            ...rebuilt,
            questsCompleted: account.questsCompleted + (merged ? 0 : guest.questsCompleted),
            mergedFrom: merged ? account.mergedFrom : [...account.mergedFrom, from],
          };
        },
      });
      const statsMoved = await gamificationAccessor.removeStats(from);
      const questDays = await gamificationAccessor.removeQuestDays(from);
      await unlockEarned({ playerId, stats, at: now, matchId: "" });
      return { moved: { achievements, stats: statsMoved, questDays } };
    },

    /**
     * The player's stats, unlocks and stored quest days, for their data export (CC-035). Bookkeeping that only
     * keeps a match from counting twice is left out.
     *
     * @param {{ playerId: string }} query
     */
    async exportPlayer({ playerId }) {
      const [stats, unlocks, questDays] = await Promise.all([
        getStats(playerId),
        gamificationAccessor.listUnlocks(playerId),
        gamificationAccessor.listQuestDays(playerId),
      ]);
      const { playerId: _id, mergedFrom, ...ownStats } = stats;
      return {
        stats: ownStats,
        achievements: unlocks.map(({ achievementId, unlockedAt, matchId }) => ({
          achievementId,
          unlockedAt: new Date(unlockedAt).toISOString(),
          matchId,
        })),
        questDays: questDays.map(({ day, items, sweepAt }) => ({ day, items, sweepAt })),
      };
    },

    /**
     * Deletes the player's stats, quest days and unlocks (CC-035). Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: { stats: number, questDays: number, achievements: number } }>}
     */
    async erasePlayer({ playerId }) {
      return {
        erased: {
          stats: await gamificationAccessor.removeStats(playerId),
          questDays: await gamificationAccessor.removeQuestDays(playerId),
          achievements: await gamificationAccessor.removeUnlocks(playerId),
        },
      };
    },
  });
}
