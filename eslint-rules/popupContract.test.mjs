import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import { classicadePlugin } from "./commentStyle.mjs";
import { CONTRACT_FILE, isPopupComponent, POPUP_COMPONENTS, popupContractRule } from "./popupContract.mjs";

// RuleTester looks for test functions on itself. Hand it the ones from Vitest.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const ROOT = path.join(import.meta.dirname, "..");
const PAGE = path.join(ROOT, "apps/web/src/pages/HomePage/NewThing.jsx");
const MODAL = path.join(ROOT, "apps/web/src/components/Modal/Modal.jsx");

describe("refuses a new pop-up type outside the contract", () => {
  tester.run("classicade/popup-contract", popupContractRule, {
    valid: [
      // The contract's own components may.
      { code: 'createPortal(<div role="dialog" />, document.body);', filename: MODAL },
      // Not a live region, and not a pop-up role.
      { code: '<p aria-live="off" role="status">Ready</p>;', filename: PAGE },
      { code: '<div role="group" />;', filename: PAGE },
      // A role worked out at run time is left to review.
      { code: "<div role={kind} />;", filename: PAGE },
      { code: "show(portal);", filename: PAGE },
    ],
    invalid: [
      {
        code: 'import { createPortal } from "react-dom"; createPortal(<p />, document.body);',
        filename: PAGE,
        errors: [{ messageId: "popup", data: { found: "createPortal" } }],
      },
      {
        code: "ReactDOM.createPortal(<p />, document.body);",
        filename: PAGE,
        errors: [{ messageId: "popup", data: { found: "createPortal" } }],
      },
      {
        code: '<div role="dialog" aria-modal="true" />;',
        filename: PAGE,
        errors: [{ messageId: "popup", data: { found: 'role="dialog"' } }],
      },
      {
        code: '<div role={"alertdialog"} />;',
        filename: PAGE,
        errors: [{ messageId: "popup", data: { found: 'role="alertdialog"' } }],
      },
      {
        code: '<p aria-live="polite">Saved</p>;',
        filename: PAGE,
        errors: [{ messageId: "popup", data: { found: "aria-live" } }],
      },
    ],
  });

  it("points at the contract in its message", () => {
    expect(popupContractRule.meta.messages.popup).toContain(CONTRACT_FILE);
  });
});

describe("the pop-up components", () => {
  it("is registered in the classicade plugin", () => {
    expect(classicadePlugin.rules["popup-contract"]).toBe(popupContractRule);
  });

  it("matches a file by its path from the root or its absolute path, on any system", () => {
    expect(isPopupComponent("apps/web/src/components/Modal/Modal.jsx")).toBe(true);
    expect(isPopupComponent(MODAL.replaceAll("/", "\\"))).toBe(true);
    expect(isPopupComponent(PAGE)).toBe(false);
    expect(isPopupComponent("apps/web/src/components/Modal/NotModal.jsx")).toBe(false);
  });

  it("only shrinks: every entry exists and is listed in the contract, and the contract lists no other", () => {
    const contract = readFileSync(path.join(ROOT, CONTRACT_FILE), "utf8");
    const section = contract
      .split("<!-- popup-components:start -->")[1]
      .split("<!-- popup-components:end -->")[0];
    const listed = [...section.matchAll(/^\| `([^`]+)`/gm)].map(([, file]) => file);
    expect(listed).toEqual(POPUP_COMPONENTS.map(({ path: file }) => file));
    for (const { path: file, reason } of POPUP_COMPONENTS) {
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
      expect(reason).toMatch(/\.$/);
    }
  });
});
