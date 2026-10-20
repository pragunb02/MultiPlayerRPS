import { randomUUID } from "node:crypto";
import { REPORT_ACTION, REPORT_CONTEXT, REPORT_REASONS, REPORT_STATUS } from "@classicade/shared";
import { deletedPlayer } from "../../models/deletedPlayer.js";
import { isAccountId } from "../../models/identity.js";
import { assertDefined, assertFunction } from "../../utils/assert.js";
import { ConflictError, NotFoundError } from "../../utils/errors.js";
import { dayOf } from "../../utils/indiaTime.js";
import { maskContacts } from "../feedback/maskContacts.js";
import { renameIdShapes } from "../identity/idShapes.js";

/**
 * When a reporter's reports count for less (ADR-071.5, after Lichess's `reportban` and reporter accuracy, softened):
 * at least this many of their kept reports were dismissed and none was acted on. Their new reports are still stored
 * and thanked as any, but marked `setAside` and listed last. Counts never act on anyone by themselves.
 */
export const REPORTER_TRUST = Object.freeze({ dismissedAtLeast: 3 });

/**
 * How much of what happened between the pair a report keeps (ADR-071.3): enough to see stalling, a move pattern or
 * a stream of requests, too little to be a game record of its own.
 */
export const REPORT_SNAPSHOT = Object.freeze({ moves: 10, requests: 5, textMax: 200 });

/**
 * What the composition root is told when the owner renamed a reported account, so it can cut the account's sockets:
 * its sessions ended with the rename (ADR-071.6).
 */
export const REPORT_EVENTS = Object.freeze({ PLAYER_RENAMED: "report:player-renamed" });

/** The one answer for every reference the server cannot confirm, so reporting cannot probe rooms, matches or handles. */
const notFound = (cause) =>
  new NotFoundError("We couldn't find that player", cause === undefined ? {} : { cause });

/** The roles a snapshot names players by. Never a player id (ADR-057). */
const ROLE = Object.freeze({ REPORTED: "reported", REPORTER: "reporter", OTHER: "other" });

/**
 * @typedef {import("../players/playerReferences.js").PlayedWith | { handle: string }} ReportTarget   who to report:
 *   a seat of an open room or a stored match (playerReferences.js), or a public profile's handle (ADR-065)
 */

/**
 * Player reports (CC-044, ADR-071). A player reports someone they played with or whose public profile they opened,
 * by where they met, never by an id. The reported player is never told. The owner reads the reports grouped by
 * player in the console and dismisses them or renames the account to a safe default.
 *
 * @param {{
 *   reportAccessor: ReturnType<typeof import("../../data/reportAccessor.js").createReportAccessor>,
 *   references: ReturnType<typeof import("../players/playerReferences.js").createPlayerReferences>,
 *   matches: { getById: (matchId: string) => Promise<Readonly<{ gameId: string, log: ReadonlyArray<Readonly<{ kind: string, playerId?: string, move?: unknown, at: number }>> }>> },
 *   profiles: { personByHandle: (query: { handle: string, viewerId: string, now: number }) => Promise<import("../players/playerReferences.js").Person> },
 *   names: { resetName: (query: { playerId: string, now: number }) => Promise<string> },
 *   newReportId?: () => string,
 *   newUuid?: () => string,
 * }} deps  `matches` is the match component's server-only full record, read for the last moves of a match.
 *   `profiles` finds the adult account behind a handle, and nobody else. `names` gives an account a safe default name
 *   and makes it show everywhere (composed in server.js). `newUuid` makes deleted reporters' stand-ins
 */
export function createReportComponent({
  reportAccessor,
  references,
  matches,
  profiles,
  names,
  newReportId = randomUUID,
  newUuid = randomUUID,
}) {
  assertDefined(reportAccessor, "reportAccessor");
  assertFunction(references?.playedWith, "references.playedWith");
  assertFunction(references?.accountsOf, "references.accountsOf");
  assertFunction(matches?.getById, "matches.getById");
  assertFunction(profiles?.personByHandle, "profiles.personByHandle");
  assertFunction(names?.resetName, "names.resetName");
  assertFunction(newReportId, "newReportId");

  /** A snapshot's text: plain JSON with every player id replaced by a role, cut to REPORT_SNAPSHOT.textMax. */
  const textOf = (value, roleOf) =>
    (JSON.stringify(renameIdShapes(value ?? null, roleOf)) ?? "null").slice(0, REPORT_SNAPSHOT.textMax);

  /** The last moves of a game log and the last requests between the pair, players named by role. */
  function recentOf({ log = [], requests = [], reporterId, reportedId }) {
    const roleOf = (playerId) =>
      playerId === reportedId ? ROLE.REPORTED : playerId === reporterId ? ROLE.REPORTER : ROLE.OTHER;
    const pair = new Set([reporterId, reportedId]);
    const moves = log
      .filter((entry) => entry.kind === "move")
      .slice(-REPORT_SNAPSHOT.moves)
      .map((entry) => ({
        by: roleOf(entry.playerId),
        kind: "move",
        text: textOf(entry.move, roleOf),
        at: entry.at,
      }));
    const asked = requests
      .filter((request) => pair.has(request.from) && pair.has(request.to))
      .slice(-REPORT_SNAPSHOT.requests)
      .map((request) => ({
        by: roleOf(request.from),
        kind: "request",
        text: `${request.type} ${request.state}`.slice(0, REPORT_SNAPSHOT.textMax),
        at: request.createdAt,
      }));
    return [...moves, ...asked].sort((a, b) => a.at - b.at);
  }

  /** The person a target names and what is kept of where they met. */
  async function resolve({ reporter, target, now }) {
    try {
      if ("handle" in target) {
        const person = await profiles.personByHandle({ handle: target.handle, viewerId: reporter.id, now });
        if (person.playerId === reporter.id) throw notFound();
        return { person, context: { kind: REPORT_CONTEXT.PROFILE } };
      }
      const { person, place } = await references.playedWith({ target, callerId: reporter.id });
      const ids = { reporterId: reporter.id, reportedId: person.playerId };
      // The room or match may still name the guest the reported player was when they sat down.
      const seatedId = (playerId, current) =>
        current(playerId) === person.playerId ? person.playerId : playerId;
      if (place.kind === "room") {
        const { room } = place;
        const current = await references.accountsOf(room.seats.map((seat) => seat.playerId));
        const log = (room.game?.log ?? []).map((entry) => ({
          ...entry,
          playerId: seatedId(entry.playerId, current),
        }));
        const requests = (room.requests ?? []).map((request) => ({
          ...request,
          from: seatedId(request.from, current),
          to: seatedId(request.to, current),
        }));
        return {
          person,
          context: {
            kind: REPORT_CONTEXT.ROOM,
            gameId: room.gameId,
            roomCode: room.code,
            ...(room.game?.matchId !== undefined && { matchId: room.game.matchId }),
            recent: recentOf({ log, requests, ...ids }),
          },
        };
      }
      const match = await matches.getById(place.matchId);
      const current = await references.accountsOf(match.log.map((entry) => entry.playerId ?? ""));
      const log = match.log.map((entry) => ({ ...entry, playerId: seatedId(entry.playerId, current) }));
      return {
        person,
        context: {
          kind: REPORT_CONTEXT.MATCH,
          gameId: match.gameId,
          matchId: place.matchId,
          recent: recentOf({ log, ...ids }),
        },
      };
    } catch (err) {
      throw err instanceof NotFoundError ? notFound(err) : err;
    }
  }

  /** Whether a reporter's earlier reports were dismissed often enough, and never acted on (REPORTER_TRUST). */
  async function isSetAside(reporterId) {
    const made = await reportAccessor.listByReporter(reporterId);
    const dismissed = made.filter((report) => report.status === REPORT_STATUS.DISMISSED).length;
    const actioned = made.some((report) => report.status === REPORT_STATUS.ACTIONED);
    return !actioned && dismissed >= REPORTER_TRUST.dismissedAtLeast;
  }

  /** One report as the console shows it: everything but who reported and who was reported. */
  const itemOf = (report) =>
    Object.freeze({
      reportId: report.reportId,
      reason: report.reason,
      ...(report.note !== undefined && { note: report.note }),
      nameThen: report.reportedName,
      context: report.context,
      setAside: report.setAside,
      createdAt: report.createdAt,
      ...(report.action !== undefined && { action: report.action, closedAt: report.closedAt }),
    });

  /** The reports about one player as one group of the console, named by its newest report's id. */
  function groupOf(reports) {
    const [newest] = reports;
    const trusted = reports.filter((report) => !report.setAside);
    const kind = isAccountId(newest.reportedId) ? "account" : "guest";
    return Object.freeze({
      groupId: newest.reportId,
      kind,
      canRename: kind === "account" && newest.status === REPORT_STATUS.OPEN,
      names: Object.freeze([...new Set(reports.map((report) => report.reportedName))]),
      reports: reports.length,
      reporters: new Set(trusted.map((report) => report.reporterId)).size,
      setAside: reports.length - trusted.length,
      reasons: Object.freeze(
        Object.fromEntries(
          REPORT_REASONS.map((reason) => [
            reason,
            reports.filter((report) => report.reason === reason).length,
          ]),
        ),
      ),
      lastAt: newest.createdAt,
      items: Object.freeze(reports.map(itemOf)),
    });
  }

  return Object.freeze({
    /**
     * Stores a report on the person at `target` and answers only its id and time, the same for every report, so the
     * answer says nothing about who that is or what will happen. A second report by the same reporter on the same
     * player the same India day answers the first one.
     *
     * @param {{ reporter: Readonly<import("../../models/identity.js").Identity>, target: ReportTarget, reason: string, note?: string, now: number }} input
     *   `reason` and `note` are already checked by the service layer
     * @returns {Promise<Readonly<{ reportId: string, createdAt: number }>>}
     * @throws {NotFoundError} for every reference the server cannot confirm, all with the same message
     */
    async report({ reporter, target, reason, note, now }) {
      const { person, context } = await resolve({ reporter, target, now });
      const masked = note === undefined ? "" : maskContacts(note);
      const { report } = await reportAccessor.add({
        reportId: newReportId(),
        reporterId: reporter.id,
        reportedId: person.playerId,
        reportedName: person.displayName,
        reason,
        ...(masked !== "" && { note: masked }),
        context,
        day: dayOf(now),
        setAside: await isSetAside(reporter.id),
        at: now,
      });
      return Object.freeze({ reportId: report.reportId, createdAt: report.createdAt });
    },

    /**
     * Who the player reported in one of their own reports, as they are now, so the thank-you can block them in one
     * tap (ADR-071.4). Server only: never sent to a client.
     *
     * @param {{ reportId: string, reporterId: string }} query
     * @returns {Promise<import("../players/playerReferences.js").Person>}
     * @throws {NotFoundError} for anyone else's report and an unknown one, alike
     */
    async reportedBy({ reportId, reporterId }) {
      const report = await reportAccessor.get(reportId);
      if (report.reporterId !== reporterId) throw new NotFoundError("No such report");
      const playerId = (await references.accountsOf([report.reportedId]))(report.reportedId);
      return Object.freeze({ playerId, displayName: report.reportedName });
    },

    /**
     * The owner's queue: the reports of one status grouped by reported player, groups with the most reporters first
     * (set aside reports do not count), then the newest. No player id, of the reporter or the reported, is in it.
     *
     * @param {{ status: string, limit: number }} query  `limit` is how many reports are read, newest first
     */
    async queue({ status, limit }) {
      const byPlayer = new Map();
      for (const report of await reportAccessor.listByStatus({ status, limit })) {
        byPlayer.set(report.reportedId, [...(byPlayer.get(report.reportedId) ?? []), report]);
      }
      const groups = [...byPlayer.values()]
        .map(groupOf)
        .sort((a, b) => b.reporters - a.reporters || b.lastAt - a.lastAt);
      return Object.freeze({ groups: Object.freeze(groups) });
    },

    /**
     * Acts on the player of a report: dismisses all their open reports, or renames their account to a safe default
     * and closes them as acted on.
     *
     * @param {{ reportId: string, action: string, now: number }} input  `action` is one of REPORT_ACTIONS
     * @returns {Promise<Readonly<{ closed: number, displayName?: string }>>}
     * @throws {NotFoundError} for an unknown report
     * @throws {ConflictError} when the report is closed already, or a rename is asked for a guest
     */
    async act({ reportId, action, now }) {
      const report = await reportAccessor.get(reportId);
      if (report.status !== REPORT_STATUS.OPEN) {
        throw new ConflictError("These reports are closed already");
      }
      const { reportedId } = report;
      if (action === REPORT_ACTION.RENAME) {
        if (!isAccountId(reportedId)) {
          throw new ConflictError("A guest's name is given by the server and cannot be renamed");
        }
        const displayName = await names.resetName({ playerId: reportedId, now });
        const closed = await reportAccessor.closeOpen({
          reportedId,
          status: REPORT_STATUS.ACTIONED,
          action,
          at: now,
        });
        return Object.freeze({ closed, displayName });
      }
      const closed = await reportAccessor.closeOpen({
        reportedId,
        status: REPORT_STATUS.DISMISSED,
        action: REPORT_ACTION.DISMISS,
        at: now,
      });
      return Object.freeze({ closed });
    },

    /**
     * A guest just signed in (ADR-014): the reports they made and the reports about them now name the account, so
     * signing in never gets round a report. Running it twice moves nothing more.
     *
     * @param {{ from: string, to: Readonly<import("../../models/identity.js").Identity>, now: number }} transfer
     * @returns {Promise<{ moved: { reports: number } }>}
     */
    async transferPlayer({ from, to }) {
      const made = await reportAccessor.moveReporter({ from, to: to.id });
      const received = await reportAccessor.moveReported({ from, to: to.id });
      return { moved: { reports: made + received } };
    },

    /**
     * The reports the player made, for their data export (CC-035): never the reported player's id and never what
     * happened to them. Reports about the player are other players' words.
     *
     * @param {{ playerId: string }} query
     */
    exportPlayer: async ({ playerId }) =>
      (await reportAccessor.listByReporter(playerId)).map((report) => ({
        reason: report.reason,
        ...(report.note !== undefined && { note: report.note }),
        where: report.context.kind,
        displayName: report.reportedName,
        reportedAt: new Date(report.createdAt).toISOString(),
      })),

    /**
     * Deletes every report about the player, and gives each report they made a stand-in of its own without its
     * note, so a report on someone who harmed them outlives their account but no longer leads to them (CC-035).
     * Running it twice changes nothing.
     *
     * @param {{ playerId: string }} input
     * @returns {Promise<{ erased: { reports: number } }>}
     */
    async erasePlayer({ playerId }) {
      const anonymised = await reportAccessor.anonymiseReporter({
        reporterId: playerId,
        standIn: () => deletedPlayer(newUuid()).id,
      });
      const removed = await reportAccessor.removeAbout(playerId);
      return { erased: { reports: anonymised + removed } };
    },
  });
}
