import { expect, it } from "vitest";
import { DuplicateKey } from "../persistence/errors.js";

const T0 = Date.UTC(2026, 9, 20, 12);
const at = (seconds) => new Date(T0 + seconds * 1000);

export const RIYA = "user_0123456789abcdef01234567";
export const ARJUN = "user_ffffffffffffffffffffffff";
export const GUEST = "guest_00000000-0000-4000-8000-000000000001";

let counter = 0;
/** A report record as the accessor writes it, with a fresh id unless one is given. */
export const reportRecord = ({
  reportId,
  reporterId = RIYA,
  reportedId = ARJUN,
  day = "2026-10-20",
  seconds = 0,
  status = "open",
  note,
  setAside = false,
} = {}) => ({
  reportId: reportId ?? `00000000-0000-4000-b000-${String(++counter).padStart(12, "0")}`,
  reporterId,
  reportedId,
  reportedName: "Arjun",
  reason: "name",
  ...(note !== undefined && { note }),
  context: {
    kind: "match",
    gameId: "rps",
    matchId: "11111111-2222-4333-8444-555555555555",
    recent: [{ by: "reported", kind: "move", text: '{"choice":"rock"}', at: at(-5) }],
  },
  day,
  setAside,
  status,
  createdAt: at(seconds),
});

const idsOf = (docs) => docs.map((doc) => doc.reportId);

/**
 * Behaviour every report DAO must have (CC-044, ADR-071): the MongoDB DAO and the in-memory double.
 *
 * @param {() => Promise<ReturnType<typeof import("../persistence/reportDao.js").createReportDao>>} createDao
 */
export function runReportDaoContract(createDao) {
  it("stores a report and answers it as stored, by id", async () => {
    const dao = await createDao();
    const report = reportRecord({ note: "Rude name" });

    expect(await dao.insert(report)).toEqual(report);
    expect(await dao.getById(report.reportId)).toEqual(report);
  });

  it("refuses a second report by the same reporter on the same player on the same day", async () => {
    const dao = await createDao();
    const first = reportRecord();
    await dao.insert(first);

    await expect(dao.insert(reportRecord())).rejects.toBeInstanceOf(DuplicateKey);
    await dao.insert(reportRecord({ day: "2026-10-21" }));
    await dao.insert(reportRecord({ reportedId: GUEST }));
    expect(await dao.getByPairDay({ reporterId: RIYA, reportedId: ARJUN, day: "2026-10-20" })).toEqual(first);
  });

  it("answers RangeError for a report that is not there", async () => {
    const dao = await createDao();

    await expect(dao.getById("00000000-0000-4000-b000-ffffffffffff")).rejects.toBeInstanceOf(RangeError);
    await expect(
      dao.getByPairDay({ reporterId: RIYA, reportedId: ARJUN, day: "2026-10-20" }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("lists the reports of one status newest first, at most `limit`", async () => {
    const dao = await createDao();
    const old = reportRecord({ seconds: 1 });
    const newer = reportRecord({ seconds: 2, reportedId: GUEST });
    const closed = reportRecord({ seconds: 3, day: "2026-10-21", status: "dismissed" });
    for (const report of [old, newer, closed]) await dao.insert(report);

    expect(idsOf(await dao.listByStatus({ status: "open", limit: 10 }))).toEqual([
      newer.reportId,
      old.reportId,
    ]);
    expect(idsOf(await dao.listByStatus({ status: "open", limit: 1 }))).toEqual([newer.reportId]);
    expect(idsOf(await dao.listByStatus({ status: "dismissed", limit: 10 }))).toEqual([closed.reportId]);
  });

  it("lists the reports one player made, newest first", async () => {
    const dao = await createDao();
    const mine = reportRecord({ seconds: 1 });
    const later = reportRecord({ seconds: 2, reportedId: GUEST });
    await dao.insert(reportRecord({ reporterId: GUEST, reportedId: RIYA }));
    await dao.insert(mine);
    await dao.insert(later);

    expect(idsOf(await dao.listByReporter(RIYA))).toEqual([later.reportId, mine.reportId]);
  });

  it("closes every open report about one player at once, and only those", async () => {
    const dao = await createDao();
    const open = [reportRecord(), reportRecord({ reporterId: GUEST })];
    const other = reportRecord({ reportedId: GUEST });
    const done = reportRecord({ day: "2026-10-19", status: "dismissed" });
    for (const report of [...open, other, done]) await dao.insert(report);

    const closed = await dao.closeOpen({
      reportedId: ARJUN,
      status: "actioned",
      action: "rename",
      closedAt: at(60),
    });

    expect(closed).toBe(2);
    for (const report of open) {
      expect(await dao.getById(report.reportId)).toEqual({
        ...report,
        status: "actioned",
        action: "rename",
        closedAt: at(60),
      });
    }
    expect(await dao.getById(other.reportId)).toEqual(other);
    expect(await dao.getById(done.reportId)).toEqual(done);
  });

  it("lists the open reports about one player", async () => {
    const dao = await createDao();
    const open = reportRecord();
    await dao.insert(open);
    await dao.insert(reportRecord({ day: "2026-10-19", status: "dismissed" }));
    await dao.insert(reportRecord({ reportedId: GUEST }));

    expect(idsOf(await dao.listOpenAbout(ARJUN))).toEqual([open.reportId]);
  });

  it("moves a guest's reports to the account on both sides, dropping one that would repeat a day's pair", async () => {
    const dao = await createDao();
    const made = reportRecord({ reporterId: GUEST, reportedId: ARJUN, day: "2026-10-18" });
    const repeat = reportRecord({ reporterId: GUEST, reportedId: ARJUN, day: "2026-10-20" });
    const kept = reportRecord({ reporterId: RIYA, reportedId: ARJUN, day: "2026-10-20" });
    const received = reportRecord({ reporterId: ARJUN, reportedId: GUEST });
    const self = reportRecord({ reporterId: GUEST, reportedId: RIYA });
    for (const report of [made, repeat, kept, received, self]) await dao.insert(report);

    expect(await dao.moveReporter({ from: GUEST, to: RIYA })).toBe(1);
    expect(await dao.moveReported({ from: GUEST, to: RIYA })).toBe(1);
    expect(await dao.moveReporter({ from: GUEST, to: RIYA })).toBe(0);

    expect((await dao.getById(made.reportId)).reporterId).toBe(RIYA);
    expect((await dao.getById(received.reportId)).reportedId).toBe(RIYA);
    await expect(dao.getById(repeat.reportId)).rejects.toBeInstanceOf(RangeError);
    // A guest who reported the account they became reported nobody.
    await expect(dao.getById(self.reportId)).rejects.toBeInstanceOf(RangeError);
    expect(await dao.getById(kept.reportId)).toEqual(kept);
  });

  it("gives each report a player made its own stand-in and drops its note, and deletes the reports about them", async () => {
    const dao = await createDao();
    const made = [reportRecord({ note: "Their words" }), reportRecord({ reportedId: GUEST, note: "More" })];
    const about = reportRecord({ reporterId: ARJUN, reportedId: RIYA });
    const unrelated = reportRecord({ reporterId: GUEST, reportedId: ARJUN });
    for (const report of [...made, about, unrelated]) await dao.insert(report);
    let standIns = 0;

    const anonymised = await dao.anonymiseReporter({
      reporterId: RIYA,
      standIn: () => `deleted_00000000-0000-4000-8000-00000000000${++standIns}`,
    });
    const deleted = await dao.deleteAbout(RIYA);

    expect({ anonymised, deleted }).toEqual({ anonymised: 2, deleted: 1 });
    const after = await Promise.all(made.map((report) => dao.getById(report.reportId)));
    expect(after.map((report) => report.reporterId).sort()).toEqual([
      "deleted_00000000-0000-4000-8000-000000000001",
      "deleted_00000000-0000-4000-8000-000000000002",
    ]);
    after.forEach((report) => expect(report).not.toHaveProperty("note"));
    await expect(dao.getById(about.reportId)).rejects.toBeInstanceOf(RangeError);
    expect(await dao.getById(unrelated.reportId)).toEqual(unrelated);
    expect(await dao.listByReporter(RIYA)).toEqual([]);
    expect(await dao.anonymiseReporter({ reporterId: RIYA, standIn: () => "never" })).toBe(0);
  });
}
