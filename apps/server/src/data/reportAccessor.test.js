import { describe, expect, it } from "vitest";
import { createInMemoryReportDao } from "../testing/inMemoryReportDao.js";
import { NotFoundError } from "../utils/errors.js";
import { createReportAccessor } from "./reportAccessor.js";

const T0 = Date.UTC(2026, 9, 20, 12);
const RIYA = "user_0123456789abcdef01234567";
const ARJUN = "user_ffffffffffffffffffffffff";
const GUEST = "guest_00000000-0000-4000-8000-000000000001";

let counter = 0;
const input = ({ at = T0, ...rest } = {}) => ({
  reportId: `00000000-0000-4000-c000-${String(++counter).padStart(12, "0")}`,
  reporterId: RIYA,
  reportedId: ARJUN,
  reportedName: "Arjun",
  reason: "cheating",
  context: {
    kind: "match",
    gameId: "chess",
    matchId: "11111111-2222-4333-8444-555555555555",
    recent: [{ by: "reported", kind: "move", text: '"e4"', at: T0 - 1000 }],
  },
  day: "2026-10-20",
  setAside: false,
  at,
  ...rest,
});

describe("reportAccessor (CC-044, ADR-071)", () => {
  it("stores a new report as open, and answers a frozen model with times in milliseconds", async () => {
    const reports = createReportAccessor({ reportDao: createInMemoryReportDao() });
    const report = input();

    const { created, report: stored } = await reports.add(report);

    const { at, ...fields } = report;
    expect(created).toBe(true);
    expect(stored).toEqual({ ...fields, status: "open", createdAt: at });
    expect(Object.isFrozen(stored)).toBe(true);
    expect(await reports.get(report.reportId)).toEqual(stored);
  });

  it("answers the day's report again for a repeat by the same reporter on the same player, without storing it", async () => {
    const reports = createReportAccessor({ reportDao: createInMemoryReportDao() });
    const first = (await reports.add(input())).report;

    const again = await reports.add(input({ reason: "name", at: T0 + 60_000 }));

    expect(again).toEqual({ created: false, report: first });
    expect(await reports.listByReporter(RIYA)).toEqual([first]);
  });

  it("answers NotFoundError for a report that is not there", async () => {
    const reports = createReportAccessor({ reportDao: createInMemoryReportDao() });

    await expect(reports.get("00000000-0000-4000-c000-ffffffffffff")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("groups open reports by player, lists those about one, closes them up to one with the action and moves and erases them", async () => {
    const reports = createReportAccessor({ reportDao: createInMemoryReportDao() });
    const about = (await reports.add(input())).report;
    const other = (await reports.add(input({ reportedId: GUEST, day: "2026-10-18" }))).report;

    const { total, groups } = await reports.listGroups({ status: "open", skip: 0, limit: 10 });
    expect(total).toBe(2);
    expect(groups.find((group) => group.reportedId === ARJUN)).toEqual({
      reportedId: ARJUN,
      reports: 1,
      reporters: 1,
      setAside: 0,
      lastAt: T0,
      newestId: about.reportId,
    });
    expect(Object.isFrozen(groups[0])).toBe(true);
    expect(await reports.listAbout({ reportedId: ARJUN, status: "open", limit: 10 })).toEqual([about]);
    const upTo = { createdAt: about.createdAt, reportId: about.reportId };
    expect(
      await reports.closeOpen({
        reportedId: ARJUN,
        upTo,
        status: "dismissed",
        action: "dismiss",
        at: T0 + 5,
      }),
    ).toBe(1);
    expect(await reports.get(about.reportId)).toEqual({
      ...about,
      status: "dismissed",
      action: "dismiss",
      closedAt: T0 + 5,
    });
    const guests = (await reports.add(input({ reporterId: GUEST, day: "2026-10-19" }))).report;
    expect(await reports.moveReporter({ from: GUEST, to: ARJUN })).toBe(0);
    expect(await reports.moveReported({ from: GUEST, to: ARJUN })).toBe(1);
    expect(await reports.anonymiseReporter({ reporterId: GUEST, standIn: () => "deleted_x" })).toBe(0);
    expect((await reports.get(other.reportId)).reportedId).toBe(ARJUN);
    expect(await reports.removeAbout(ARJUN)).toBe(2);
    await expect(reports.get(guests.reportId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
