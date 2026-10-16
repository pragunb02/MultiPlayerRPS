import { afterEach, describe, expect, it } from "vitest";
import { removeServerHead, SERVER_HEAD_ATTRIBUTE } from "./serverHead.js";

afterEach(() => {
  document.head.innerHTML = "";
});

describe("removeServerHead", () => {
  it("removes the tags the server wrote for the first page and keeps every other head tag", () => {
    document.head.innerHTML = `
      <meta charset="UTF-8">
      <title ${SERVER_HEAD_ATTRIBUTE}>Join my Chess game on ClassiCade</title>
      <meta name="description" content="invite" ${SERVER_HEAD_ATTRIBUTE}>
      <meta property="og:title" content="invite" ${SERVER_HEAD_ATTRIBUTE}="">
      <link rel="icon" href="/favicon.svg">`;

    removeServerHead(document);

    expect([...document.head.children].map((element) => element.outerHTML)).toEqual([
      '<meta charset="UTF-8">',
      '<link rel="icon" href="/favicon.svg">',
    ]);
  });

  it("does nothing when the server wrote nothing (the development server)", () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.svg">';

    removeServerHead(document);

    expect(document.head.children).toHaveLength(1);
  });
});
