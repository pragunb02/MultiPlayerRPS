import { answerTo, arm, installProbe } from "./controlProbe.js";
import { createRoom, expect, test } from "./fixtures.js";
import { newAccount } from "./personas.js";

// Sharing on WhatsApp (CC-217). The waiting room and the result screen offer a wa.me link and the device's share
// sheet, with a copy of the message where there is no sheet. The text tells the result the way Wordle does and
// names nobody: not the player, not the opponent, whether a guest, a minor or an adult. The link is the game's
// page on the site's own address, because a finished room closes soon.
//
// Every link carries its channel and nothing else (CC-279): `?via=wa`, `share` or `copy`. A visit by such a link is
// a `shared_link` landing of that channel, and the marker leaves the address at once.

const RPS_PAGE = "/games/rock-paper-scissors";
// The first release's preview images. Messages sent before still point at them, so they must keep answering.
const RETIRED_IMAGES = [
  "/og/classicade.png",
  "/og/rock-paper-scissors.png",
  "/og/tic-tac-toe.png",
  "/og/chess.png",
];

async function signUp(page, account, birthYear) {
  await page.goto("/signup");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByLabel("Year of birth").selectOption(String(birthYear));
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
}

/** `host` creates a one round game of Rock Paper Scissors, `guest` joins by the link as a guest, and `host` wins. */
async function hostBeatsGuest(host, guest) {
  await host.page.goto(RPS_PAGE);
  await host.page.getByRole("combobox", { name: /match length/i }).selectOption("1");
  await host.page.getByRole("button", { name: "Create room" }).click();
  const invite = await host.page.getByRole("textbox", { name: "Invite link" }).inputValue();
  await guest.page.goto(invite);
  await guest.page.getByRole("button", { name: "Play as guest" }).click();
  await host.page.getByRole("group", { name: "Your choice" }).getByRole("button", { name: /Rock/ }).click();
  await guest.page
    .getByRole("group", { name: "Your choice" })
    .getByRole("button", { name: /Scissors/ })
    .click();
  await expect(host.page.getByRole("heading", { name: /^You won/ })).toBeVisible();
  await expect(guest.page.getByRole("heading", { name: /^You lost/ })).toBeVisible();
  return { code: new URL(invite).pathname.split("/").pop() };
}

/** The message inside a wa.me link, after checking the link is WhatsApp's click to chat and nothing else. */
async function whatsappMessage(page) {
  const href = await page.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href");
  const link = new URL(href);
  expect(`${link.origin}${link.pathname}`).toBe("https://wa.me/");
  expect([...link.searchParams.keys()]).toEqual(["text"]);
  return link.searchParams.get("text");
}

/** Everything personal the player's session holds: their id and their name, as the server knows them. */
async function personalOf(page) {
  const { identity } = await (await page.request.get("/api/session")).json();
  return [identity.id, identity.displayName];
}

test.describe("sharing on WhatsApp", () => {
  test("the result screen offers WhatsApp and Share, with the result, the game page's link and no names", async ({
    players,
    baseURL,
  }) => {
    const account = newAccount();
    const adult = await players.open("adult", { secrets: [account.email, account.password] });
    const guest = await players.open("guest");
    await signUp(adult.page, account, 1990);
    // The adult's browser has a share sheet. It records what it was given instead of opening.
    await adult.context.addInitScript(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => {
          window.__shared = data;
        },
      });
    });

    const { code } = await hostBeatsGuest(adult, guest);

    const gamePage = `${baseURL}${RPS_PAGE}?via=wa`;
    const won = await whatsappMessage(adult.page);
    const lost = await whatsappMessage(guest.page);
    expect(won).toBe(
      `🏆 Maine Rock Paper Scissors jeeta! Ab tumhari baari:\nI won a game of Rock Paper Scissors on ClassiCade. Your turn!\nFree hai, login nahi chahiye.\nFree, no login needed.\n${gamePage}`,
    );
    expect(lost).toBe(
      `🎯 Aaj Rock Paper Scissors mein haar mili. Badla loge?\nI played Rock Paper Scissors on ClassiCade and lost. Can you do better?\nFree hai, login nahi chahiye.\nFree, no login needed.\n${gamePage}`,
    );
    const personal = [
      code,
      account.username,
      account.email,
      ...(await personalOf(adult.page)),
      ...(await personalOf(guest.page)),
    ];
    expect(personal.some((value) => value.startsWith("Guest-"))).toBe(true);
    for (const message of [won, lost]) {
      for (const value of personal) {
        expect(message).not.toContain(value);
      }
    }
    await expect(adult.page.getByRole("link", { name: "Send on WhatsApp" })).toHaveAttribute(
      "target",
      "_blank",
    );

    // A reload brings the same share back: it is drawn from the room, not from the moment the game ended.
    await adult.page.reload();
    await adult.page.getByRole("button", { name: "Share result" }).click();
    await expect
      .poll(() => adult.page.evaluate(() => window.__shared))
      .toEqual({
        title: "ClassiCade",
        text: "🏆 Maine Rock Paper Scissors jeeta! Ab tumhari baari:\nI won a game of Rock Paper Scissors on ClassiCade. Your turn!\nFree hai, login nahi chahiye.\nFree, no login needed.",
        url: `${baseURL}${RPS_PAGE}?via=share`,
      });
  });

  test("without a share sheet, Share result copies the message and says so within 100 ms", async ({
    players,
  }) => {
    const host = await players.open("host");
    const guest = await players.open("guest");
    await installProbe(host);
    await host.context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__copied = text;
          },
        },
      });
    });

    await hostBeatsGuest(host, guest);
    const share = host.page.getByRole("button", { name: "Share result" });
    const armed = await arm(host.page);
    await share.click();

    await expect(host.page.getByRole("status").filter({ hasText: "Result copied" })).toBeVisible();
    expect((await answerTo(host.page, armed)).ms).toBeLessThanOrEqual(100);
    const copied = await host.page.evaluate(() => window.__copied);
    expect(copied.endsWith(`${RPS_PAGE}?via=copy`)).toBe(true);
    expect(copied.replace(/via=copy$/, "via=wa")).toBe(await whatsappMessage(host.page));
  });

  test("the waiting room offers WhatsApp with the room's invite on the site's own address", async ({
    players,
    baseURL,
  }) => {
    const host = await players.open("host");

    const room = await createRoom(host, "chess");

    expect(room.invite).toBe(`${baseURL}/games/chess/rooms/${room.code}?via=copy`);
    expect(await whatsappMessage(host.page)).toBe(
      `Ek game ho jaaye? ClassiCade pe Chess khelo, link kholo aur seedha khelo:\nPlay Chess with me on ClassiCade — room ${room.code}\nFree hai, login nahi chahiye.\nFree, no login needed.\n${baseURL}${room.path}?via=wa`,
    );
  });

  test("a visit by a WhatsApp link lands as a shared link, and the marker leaves the address", async ({
    players,
  }) => {
    const friend = await players.open("friend");
    await friend.page.goto("/games/chess");
    const before = await friend.page.evaluate(() => history.length);

    await friend.page.goto("/games/chess?via=wa#play");

    await expect(friend.page).toHaveURL("/games/chess#play");
    await expect(friend.page.locator("html")).toHaveAttribute("data-cc-entry", "shared_link");
    await expect(friend.page.locator("html")).toHaveAttribute("data-cc-via", "wa");
    await expect(friend.page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new URL("/games/chess", friend.page.url()).href,
    );
    // The marked address was replaced, not added: one entry for the visit, and Back goes to the page before it.
    expect(await friend.page.evaluate(() => history.length)).toBe(before + 1);
    await friend.page.goBack();
    await expect(friend.page).toHaveURL("/games/chess");
    await friend.page.goForward();
    await expect(friend.page).toHaveURL("/games/chess#play");
    // A reload is not a second share, and nothing about the landing is kept in the browser.
    await friend.page.reload();
    await expect(friend.page).toHaveURL("/games/chess#play");
    await expect(friend.page.locator("html")).not.toHaveAttribute("data-cc-entry");
  });

  test("a friend who opens a copied room link lands as a shared link at the room's own address", async ({
    players,
  }) => {
    const host = await players.open("host");
    const friend = await players.open("friend");
    const room = await createRoom(host, "tic-tac-toe");

    await friend.page.goto(room.invite);

    await expect(friend.page).toHaveURL(room.path);
    await expect(friend.page.locator("html")).toHaveAttribute("data-cc-via", "copy");
    await friend.page.getByRole("button", { name: "Play as guest" }).click();
    await expect(friend.page.getByRole("button", { name: "Play as guest" })).toHaveCount(0);
    await expect(friend.page).toHaveURL(room.path);
  });

  test("a marker that is not one of ours is not counted and still leaves the address", async ({
    players,
  }) => {
    const visitor = await players.open("visitor");

    await visitor.page.goto("/games/rock-paper-scissors?via=u_5f2a9c&via=wa");

    await expect(visitor.page).toHaveURL(RPS_PAGE);
    await expect(visitor.page.locator("html")).not.toHaveAttribute("data-cc-entry");
    await expect(visitor.page.locator("html")).not.toHaveAttribute("data-cc-via");
  });

  test("the new preview images serve as small JPEGs, and the old PNG addresses still answer", async ({
    request,
  }) => {
    const html = await (await request.get(RPS_PAGE, { headers: { Accept: "text/html" } })).text();
    const image = html.match(/<meta property="og:image" content="([^"]*)"/)[1];

    const jpeg = await request.get(image);
    expect(jpeg.status()).toBe(200);
    expect(jpeg.headers()["content-type"]).toBe("image/jpeg");
    expect((await jpeg.body()).length).toBeLessThan(150 * 1024);
    for (const path of RETIRED_IMAGES) {
      const old = await request.get(path);
      expect(old.status(), path).toBe(200);
      expect(old.headers()["content-type"], path).toBe("image/png");
    }
  });
});
