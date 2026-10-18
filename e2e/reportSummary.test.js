import { describe, expect, it } from "vitest";

import { countByStatus, fileTimes, problemsOf, summary, testsIn } from "./reportSummary.js";

// Reports shaped like Playwright's JSON reporter: file suites, describe suites, specs, one test per project.
const result = (duration, status = "passed") => ({ duration, status });
const spec = (id, title, tests) => ({ id, title, file: "x.spec.js", line: 1, tests });
const test = (projectName, results, status = "expected") => ({ projectName, results, status });

const listed = {
  suites: [
    {
      title: "a.spec.js",
      file: "a.spec.js",
      specs: [spec("a1", "opens", [test("desktop", [], "skipped"), test("mobile", [], "skipped")])],
      suites: [
        {
          title: "games",
          file: "a.spec.js",
          specs: [spec("a2", "plays", [test("desktop", [], "skipped")])],
        },
        // A describe block that holds only other describe blocks has no specs of its own.
        { title: "nothing here", file: "a.spec.js", suites: [] },
      ],
    },
    { title: "b.spec.js", file: "b.spec.js", specs: [spec("b1", "waits", [test("desktop", [], "skipped")])] },
  ],
};

const ran = (overrides = {}) => ({
  suites: [
    {
      title: "a.spec.js",
      file: "a.spec.js",
      specs: [
        spec("a1", "opens", [
          test("desktop", [result(1500)]),
          test("mobile", [result(500, "skipped")], "skipped"),
        ]),
      ],
      suites: [
        {
          title: "games",
          file: "a.spec.js",
          specs: [spec("a2", "plays", [test("desktop", [result(2000)])])],
        },
      ],
    },
    {
      title: "b.spec.js",
      file: "b.spec.js",
      specs: [spec("b1", "waits", [test("desktop", overrides.b1 ?? [result(30_000)])])],
    },
  ],
});

describe("testsIn", () => {
  it("lists every test once per project, named by its spec file and describe titles", () => {
    expect(testsIn(listed).map((entry) => entry.name)).toEqual([
      "[desktop] a.spec.js › opens",
      "[mobile] a.spec.js › opens",
      "[desktop] a.spec.js › games › plays",
      "[desktop] b.spec.js › waits",
    ]);
  });

  it("files a test under the spec file that loaded it, not the helper that declared it", () => {
    const report = {
      suites: [
        {
          title: "p.spec.js",
          file: "p.spec.js",
          specs: [{ ...spec("p", "t", []), file: "helper.js", tests: [test("desktop", [])] }],
        },
      ],
    };

    expect(testsIn(report)[0].file).toBe("p.spec.js");
  });
});

describe("problemsOf", () => {
  it("finds nothing when every listed test ran once", () => {
    expect(problemsOf({ listed: testsIn(listed), ran: testsIn(ran()) })).toEqual([]);
  });

  it("names a listed test that did not run", () => {
    const partial = ran();
    partial.suites.pop();

    expect(problemsOf({ listed: testsIn(listed), ran: testsIn(partial) })).toEqual([
      "did not run: [desktop] b.spec.js › waits",
    ]);
  });

  it("names a test that ran but is not on the list", () => {
    const shorter = structuredClone(listed);
    shorter.suites.pop();

    expect(problemsOf({ listed: testsIn(shorter), ran: testsIn(ran()) })).toEqual([
      "not on the list: [desktop] b.spec.js › waits",
    ]);
  });

  it("names a test that ran twice, whether in two parts or as two results", () => {
    const twice = ran();
    twice.suites.push(structuredClone(twice.suites[1]));

    expect(problemsOf({ listed: testsIn(listed), ran: testsIn(twice) })).toEqual([
      "ran 2 times: [desktop] b.spec.js › waits",
    ]);
    expect(
      problemsOf({ listed: testsIn(listed), ran: testsIn(ran({ b1: [result(1), result(2)] })) }),
    ).toEqual(["ran 2 times: [desktop] b.spec.js › waits"]);
  });
});

describe("countByStatus", () => {
  it("counts the tests by how they ended", () => {
    expect(countByStatus(testsIn(ran()))).toEqual({ expected: 3, skipped: 1 });
  });
});

describe("fileTimes", () => {
  it("adds up each file's time per project, longest file first", () => {
    expect(fileTimes(testsIn(ran()))).toEqual([
      { file: "b.spec.js", total: 30, byProject: { desktop: 30 } },
      { file: "a.spec.js", total: 4, byProject: { desktop: 3.5, mobile: 0.5 } },
    ]);
  });

  it("orders files of equal time by name", () => {
    const even = testsIn(ran({ b1: [result(3500), result(500)] }));

    expect(fileTimes(even).map((row) => row.file)).toEqual(["a.spec.js", "b.spec.js"]);
  });
});

describe("summary", () => {
  it("gives the counts, says every test ran once, and tables the files with a column per project", () => {
    expect(summary({ title: "Chromium", listed: testsIn(listed), ran: testsIn(ran()) })).toBe(
      [
        "## Chromium",
        "",
        "4 tests listed, 4 ran (3 expected, 1 skipped).",
        "Every listed test ran exactly once.",
        "",
        "| File | Seconds | desktop | mobile |",
        "| --- | ---: | ---: | ---: |",
        "| b.spec.js | 30.0 | 30.0 |  |",
        "| a.spec.js | 4.0 | 3.5 | 0.5 |",
        "",
      ].join("\n"),
    );
  });

  it("lists the problems instead when there are any", () => {
    const partial = ran();
    partial.suites.pop();

    expect(summary({ title: "Chromium", listed: testsIn(listed), ran: testsIn(partial) })).toContain(
      "Problems:\n\n- did not run: [desktop] b.spec.js › waits",
    );
  });
});
