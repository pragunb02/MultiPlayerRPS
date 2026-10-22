import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCommonPasswords } from "./commonPasswords.js";

const listFile = (text) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "cc-common-")), "list.txt");
  writeFileSync(file, text);
  return pathToFileURL(file);
};

describe("the common password list", () => {
  const list = loadCommonPasswords();

  it("holds the SecLists list of the most common passwords, 10,001 lines", () => {
    expect(list.size).toBe(10_001);
    expect(list.has("password")).toBe(true);
    expect(list.has("12345678")).toBe(true);
    expect(list.has("iloveyou")).toBe(true);
  });

  it("does not hold an ordinary passphrase", () => {
    expect(list.has("correct horse battery")).toBe(false);
  });

  it("keeps each entry in lower case, without spaces at the ends, and skips blank lines", () => {
    const small = loadCommonPasswords({ file: listFile("Password1\r\n  qwertyuiop \n\n") });

    expect(small.size).toBe(2);
    expect(small.has("password1")).toBe(true);
    expect(small.has("qwertyuiop")).toBe(true);
  });

  it("can only be read", () => {
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.keys(list).sort()).toEqual(["has", "size"]);
  });
});
