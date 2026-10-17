# ClassiCade growth plan

Status: accepted by the owner on 18 October 2026 (ADR-031, ADR-032). Owner: growth lead. This file is meant to be saved as `docs/GROWTH.md`, which CLAUDE.md working agreement item 7 names as the home for sharing plans.

This plan answers three questions from the owner:

1. How do people find the site while it is on the free tier?
2. How do we get a first-day player to come back on day 2?
3. How do we send notifications that are "not too much, not too little"?

Sources were fetched on 17 October 2026 unless a different date is shown. A claim marked "general knowledge" comes with a confidence level. A number marked "guess" is an unsupported estimate. Every cost says whether it is free or paid.

> **How this plan fits the working agreement (CLAUDE.md, 17 Oct 2026)**
>
> 1. **What "now" means.** Only owner actions that need no code, plus work already written on a ticket's title on the board. Nothing in this plan adds scope to an existing ticket.
> 2. **New work goes to `docs/IDEAS.md`.** Every new scope item is listed in section 7.2 by name, with no ticket number. Each one becomes a ticket only after the freeze lifts or the owner grants an exception. When that happens, it takes the next free ID on the board at that moment.
> 3. **The board order stays as it is.** Phase 0 comes first (CC-105, CC-107, CC-116, CC-117, CC-118, CC-122 and PRs #51 and #53), then the vision §8.3 top 10. Security is P0 by default. This plan does not move any ticket.
> 4. **Launch is by word of mouth among friends, when the owner decides.** Posting anywhere beyond the owner's friends needs a second, explicit owner launch decision, written in `docs/DECISIONS.md`. That decision comes after Phase 0 and every open security P0 are closed.

---

## 1. Goals and constraints

### 1.1 Constraints we accept

- **Hosting**
  - We are on Render's free tier in Oregon. The site sleeps after 15 minutes idle and takes about a minute to wake (https://render.com/docs/free).
  - Each workspace gets 750 instance hours a month. Keeping one service awake all month uses about 744 hours in a 31 day month, which leaves **6 hours of headroom**. A preview environment or a second free service in the same workspace would push us over, and every free service would then be suspended for the rest of the month.
  - Going over the bandwidth allowance with no card on file also suspends every free service for the month (same source).
  - The bandwidth allowance is about 100 GB a month (general knowledge, medium confidence, so check the Render dashboard). A first visit weighs about 0.3 to 0.5 MB: 135 KB of JS, 12 KB of CSS, about 3 KB of HTML, a game chunk of up to 100 KB, images, and Socket.IO traffic. That allows roughly 200,000 first visits a month, so bandwidth is not our limit at the numbers in this plan. The real limits are cold starts and the hours headroom.
- **The uptime ping is not a guarantee.** It is a GitHub Actions schedule (`.github/workflows/uptime.yml`, every 10 minutes). DEPLOYMENT.md already notes two things:
  - Scheduled runs are best effort. They are often a few minutes late and sometimes skipped.
  - GitHub switches off scheduled workflows in a public repository after 60 days without a commit.

  So "keeps it mostly awake" is the honest claim, not "keeps it awake".

- **Database:** MongoDB Atlas M0, about 100 operations a second.
- **Money:** no budget. The only spend this plan recommends now is a domain, about ₹800 to ₹1,500 a year (general knowledge, medium confidence. Check live registrar prices before buying).
- **People:** one owner, who also runs the builders. **Growth work is capped at 2 to 3 hours a week.**
- **Market:** India first.
  - 93.9% of Indian mobile devices run Android (StatCounter, September 2026, cited in PRODUCT_VISION.md).
  - The most common screen is 360x800, at 15.28% (https://gs.statcounter.com/screen-resolution-stats/mobile/india).
  - The top vendors are Vivo, Oppo and Xiaomi (https://gs.statcounter.com/vendor-market-share/mobile/india).
- **Promises from PRODUCT_VISION.md (binding):** playing within 10 seconds, never pay-to-win, no betting or cash, safe for kids by default, and at most one reminder a day.
- **ADR-028:** unknown age counts as a minor.
- **ADR-029:** crowd features stay off until the crowd exists.

### 1.2 What this means in plain words

- **Most of the next 90 days is Phase 0 and Phase 1 building.** Growth in that window is the owner getting ready (a domain, page text, a list of friends to invite), then a friends launch when the owner decides.
- **Weekly Returning Players will come almost entirely from pairs and groups of friends, not from search.** Search is slow (section 2), and strangers who arrive at random hours mostly meet characters, not people (section 3.5).
- **Reminders will reach almost nobody in this window.** Section 4.4 explains why.

### 1.3 Targets: cohorts counted from the owner's launch date

These are guesses, low confidence. We replace them with our own numbers after 4 weeks of data from the owner console (CC-233).

| Metric                                                              | Target                                                                                                              | Floor that triggers a look | Reasoning                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch cohort (first 2 weeks after the friends launch)              | 100 to 300 first-time players                                                                                       | Under 50                   | The owner's reachable friends and their groups (guess). One-off pools spike and then decay (general knowledge, medium confidence)                                         |
| Conversion to play (visitor to first move)                          | 50%                                                                                                                 | 35%                        | Same as the vision's phase 1 launch target (PRODUCT_VISION.md §7.2)                                                                                                       |
| First game finished                                                 | 75% of first movers                                                                                                 | 60%                        | Guess                                                                                                                                                                     |
| D1 return, launch cohort                                            | 15%                                                                                                                 | 10%                        | Matches the vision's phase 1 guess. The only published web figure calls 10 to 15% "strong" for portal games (https://docs.crazygames.com/resources/basic-launch-metrics/) |
| D7 return, launch cohort                                            | 5%                                                                                                                  | 3%                         | Matches the vision's phase 1 guess. The mobile medians are 3.1 to 6.2% (GameAnalytics 2025)                                                                               |
| Viral factor k (invites per player × share of invites that convert) | 0.15 or more                                                                                                        | Under 0.1                  | The vision's assumption. Measured from CC-217 share cards plus the CC-233 console                                                                                         |
| Total visitors in 90 days                                           | 300 to 1,000 if k stays under 0.15. Up to about 2,000 only if k is 0.15 or more and the owner opens public channels |                            | No weekly inflow is assumed after launch week                                                                                                                             |
| WRP in week 12 after launch                                         | 15 to 40, almost all friend pairs                                                                                   | Under 10                   | Guess                                                                                                                                                                     |
| Search clicks a month by week 12                                    | 0 to 100                                                                                                            |                            | CC-216 is phase 1 P2 and may not ship in the window. Only 1.74% to 6.11% of new pages reach the top 10 within a year (Ahrefs, 15 May 2025)                                |

**Growth rule.** We grow beyond the launch cohort only when the measured k is 0.15 or more for two weeks running. Below that, effort goes into the first session and day 2, not into new channels.

**Gates are an owner decision, not a ticket.** PRODUCT_VISION.md §7.2 calls D1 of 25 to 30% and D7 of 8 to 12% the casual mobile median. GameAnalytics 2025 puts the median at about 20% D1 and 3 to 6% D7, and those are installed mobile apps, not web games. This plan does **not** change any accepted gate. After 4 weeks of our own cohort data, the owner should write a decision record in `docs/DECISIONS.md` that sets the phase 2 exit gate. It should draw on our own numbers and the web reference (CrazyGames, 10 to 15% D1 "strong"), not on mobile medians.

---

## 2. Being found (search)

### 2.1 The real problem today

The onrender.com address is not the main blocker. The empty page is.

- **No content in the HTML.** Every page sends crawlers about 2.6 KB of HTML whose body is only `<div id="root"></div>` (curl on /, /games/chess and /games/tic-tac-toe, 17 Oct 2026).
- **Google advises server rendering.** Google renders JavaScript later, in a queue, and says server-side rendering "is still a great idea ... not all bots can run JavaScript" (https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics, updated 4 Mar 2026).
- **Link previews.** WhatsApp and Telegram previews do not run JavaScript either.
- **Not indexed yet.** Bing `site:` shows nothing, and the Wayback Machine has no captures (medium confidence, because Bing was noisy).
- **What already works (CC-047, done):** titles, descriptions, canonical tags, OG cards, robots.txt, a sitemap with 11 URLs, `noindex` on rooms and /play, real 404s, and an HTTP to HTTPS 301.
- **The fix is CC-216** ("Server-rendered game page content for search", phase 1, P2). It is already on the board. The owner can write its text now, at no code cost.

### 2.2 Search Console and Bing with no code (owner, about 1 hour, free)

A URL-prefix property on onrender.com would need a meta tag or file in the code, which is new scope. Buying the domain first avoids that.

1. **Week 1.** Buy the domain (section 2.6). At the registrar, add Google Search Console's DNS TXT record and create a **Domain property** for it. This is verified by DNS, so it needs no code.
2. **Same day.** Create a Bing Webmaster Tools account. Later, import the property from Search Console. Bing's results also power DuckDuckGo and Yahoo (general knowledge, medium confidence).
3. **When CC-123 is live** (the site served on the domain, with the 301 from onrender):
   - Submit `https://<domain>/sitemap.xml`.
   - Use URL Inspection, then Request indexing, for `/` and the three game pages.
   - Run a `site:` search to get a baseline.
4. **Check that the Render workspace holds only this one free service.** Google slows crawling on 5xx errors and eventually drops URLs that keep failing (https://developers.google.com/search/docs/crawling-indexing/http-network-errors, 4 Feb 2026).

### 2.3 Target searches

- **No volume numbers.** No free tool gives search volumes. "Demand seen" comes from Google autocomplete for India (gl=in), which shows that demand exists but not how much.
- **Keyword Planner** is free but needs a Google Ads account.
- **Our real keyword tool** will be the Search Console Performance report, 3 to 4 weeks after CC-123 is live.

| Search                                               | Language   | Demand seen                  | Difficulty                                                  | Decision                                                                |
| ---------------------------------------------------- | ---------- | ---------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| stone paper scissors online / with friends           | English IN | Autocomplete shows it        | Low. Bing India shows stone shops, not games                | **First priority (RPS page)**                                           |
| rock paper scissors online with friends              | English    | Autocomplete shows it        | Low. rpsgame.org ranks with 8 words of text                 | **First priority (RPS page)**                                           |
| chess online free without login / no sign up / guest | English    | Several suggestions          | Medium                                                      | Chess page                                                              |
| play chess online with friends send link             | English    | Autocomplete shows it        | Medium                                                      | Chess page                                                              |
| tic tac toe 2 player online, xo game 2 player online | English    | Autocomplete shows it        | High. Portals hold it                                       | Tic Tac Toe page, expect it to be slow                                  |
| zero kata online                                     | Hinglish   | General knowledge, medium    | Probably low                                                | One mention on the Tic Tac Toe page                                     |
| शतरंज के नियम, पत्थर कागज कैंची के नियम              | Hindi      | Autocomplete shows it        | Low to medium (guess)                                       | **Later.** Needs separate Hindi pages and a native review (section 2.7) |
| chess khelo, tic tac toe khelo                       | Hinglish   | Academies and voice commands | Not a game intent                                           | Don't target                                                            |
| play chess online, tic tac toe, online games         | English    | Huge                         | Out of reach: Chess.com, Lichess, Poki, Google's own widget | Don't target                                                            |

Sources: suggestqueries.google.com (gl=in, hl=en and hl=hi), DuckDuckGo and Bing (cc=IN) results, all 17 Oct 2026.

### 2.4 Page by page checklist

**Part A: inside CC-216's written scope (server-rendered page content).** The owner writes the text, and a builder ships it when CC-216 comes up in board order.

**Home `/`**

- [ ] An h1 such as "Classic games with friends. Free, no login, play in 10 seconds."
- [ ] Three game tiles as real `<a href>` links.
- [ ] 150 to 300 words: what ClassiCade is, safe for kids, no betting, works on any phone.

**Each game page `/games/:slug`.** This follows the pages that rank today: papergames.io has about 1,181 words, bloob.io/rps about 914 and Poki about 667 (curl, 17 Oct 2026).

- [ ] An h1 with the long-tail phrase:
  - "Rock Paper Scissors online with friends (Stone Paper Scissors)"
  - "Tic Tac Toe 2 player online (Zero Kata, XO game)"
  - "Chess online with friends, free, no login"
- [ ] Play buttons above the fold: "Play Rocky" and "Invite a friend".
- [ ] 600 to 1,200 words of unique text: how to play, the full rules, 3 to 5 tips, and a short FAQ (No login? On my phone? Safe for kids? Free?). The rules live **on the game page**, so no new pages are needed.
- [ ] Links to the other games and the leaderboards.
- [ ] The same text that React shows, so it can never be mistaken for cloaking. Do not use "dynamic rendering", which Google calls "a workaround and not a recommended solution" (https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering).

**Invite link preview (inside CC-217's written scope: "under 300 KB, a WhatsApp button and Hinglish text, never a minor's or a guest's username")**

- [ ] Room pages stay `noindex` (done).
- [ ] Share images under 300 KB, as the ticket says. Today they are 289 to 392 KB (classicade.png is 391,824 bytes). A JPEG or WebP at 1200x630 usually lands near 100 to 200 KB, which is still inside the ticket. Keep the width and height tags so the first share renders (https://developers.facebook.com/docs/sharing/webmasters/images/).
- [ ] A `https://wa.me/?text=` button next to the existing share button.
- [ ] Hinglish share text. The owner drafts it (section 2.7, week 8).

**Part B: ideas for `docs/IDEAS.md`, not started** (section 7.2)

- JSON-LD:
  - `WebSite` and `Organization` on the home page. This is how Google shows a site name (https://developers.google.com/search/docs/appearance/site-names).
  - `BreadcrumbList` and `VideoGame` with `WebApplication` (price 0) on the game pages.
  - **Never `aggregateRating` without real ratings** (https://developers.google.com/search/docs/appearance/structured-data/software-app, 8 Sep 2026).
  - FAQPage markup gains nothing, because FAQ rich results stopped showing on 7 May 2026 (Google FAQPage changelog).
- An accurate sitemap `<lastmod>`. Google uses it only when it is "consistently and verifiably" accurate (https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap, 8 Jul 2026).
- An IndexNow key and a ping on deploy. It is free and works for Bing and others, but not Google (https://www.indexnow.org/documentation).
- Hindi pages with reciprocal hreflang (https://developers.google.com/search/docs/specialty/international/localized-versions, 21 Sep 2026).
- A per-challenge og:title such as "Riya challenged you to Stone Paper Scissors". CC-217 covers the card, and a per-challenge title may be new scope, so the builder confirms against the ticket.

**Part C: owner checks with no code**

- [ ] When CC-232 ships, ask the builder to confirm what status code the cold-start screen sends, so crawlers never index a "waking up" page. This is a check of CC-232's existing scope, not new work.

### 2.5 Speed budget

These are targets to check against existing tickets, not new work.

- **Core Web Vitals, at the 75th percentile:** LCP of 2.5 s or less, INP of 200 ms or less and CLS of 0.1 or less (https://web.dev/articles/vitals).
- **First route:** at most 150 KB compressed. This is met today with 135 KB of JS and 12 KB of CSS.
- **Each game board chunk:** at most 100 KB.
- **Share image:** under 300 KB (CC-217).
- **Fonts:** system fonts or one WOFF2 subset.
- **LCP element.** Once CC-216 ships, the server-rendered h1 becomes the LCP element before the JS arrives. That is the biggest speed gain for Indian users of a server in Oregon.
- **How to measure.** All free:
  - Lighthouse in Chrome DevTools at 360x800 with Fast 3G throttling.
  - PageSpeed Insights.
  - A new site has no CrUX field data, so lab numbers come first.
- **Phones.** Test on a budget Vivo, Oppo or Xiaomi phone.
- **Data cost is not the constraint.** 1 GB costs USD 0.16 in India (https://bestbroadbanddeals.co.uk/mobiles/worldwide-data-pricing/). Speed and RAM are.

### 2.6 The custom domain question (CC-123, phase 1, first in the top 10)

- **Cost.** About ₹800 to ₹1,500 a year (general knowledge, medium confidence). Renewals often cost more than the first year. Custom domains are free on Render's free plan, with automatic TLS (https://render.com/docs/custom-domains).
- **Ranking.** The onrender.com address carries no ranking penalty. onrender.com is on the Public Suffix List, so our site counts as its own site. Keywords in a domain "have hardly any effect" (https://developers.google.com/search/docs/fundamentals/seo-starter-guide).
- **What the subdomain does cost:**
  - Brand: "nocapgaming" is not "ClassiCade".
  - Parents' trust when they see the link.
  - Every share and link made before the move.
- **Email** cannot be sent from onrender.com, so CC-033 needs the domain too.
- **When: buy it in week 1, and post nothing beyond a few test messages until CC-123 is live.**
  - Moving with no links costs almost nothing.
  - Moving later costs "a few weeks or more" of ranking churn (https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes, 20 Aug 2026).
  - Buying the domain is an owner action. Pointing it at Render and the 301 are CC-123 work, done in board order.
- **Which ending.** Pick `.com` if it is available, because the global portals and Ludo come later. Otherwise pick `.in`, which is a strong India signal.
- **How the move works.** Steps 1 and 2 are CC-123 scope. The rest are owner actions.
  1. Keep the onrender subdomain enabled. Disabling it makes it return 404 instead of redirecting.
  2. Add a server-side 301 by Host header to the same path on the new domain, and update `ALLOWED_ORIGINS`.
  3. In Search Console, Change of Address needs the old property verified too. That takes code on onrender, so skip the tool and rely on the 301s, which Google follows anyway. This is fine because the old host has almost no indexed pages.
  4. Keep the redirects for at least a year.
- **Email DNS.** SPF, DKIM and DMARC are DNS records the owner adds at the registrar when CC-033 starts. They are not part of CC-123.

### 2.7 Twelve week content plan (about 1 hour a week)

All text is drafted in English and kept in the CC-216 ticket file (`docs/tickets/CC-216.md`), ready for when CC-216 comes up. **No Hindi pages in this window.** Google can treat unreviewed machine translation as scaled content abuse (https://developers.google.com/search/docs/essentials/spam-policies, 28 Aug 2026), and a native review costs time the owner does not have.

| Week     | Content (owner)                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Buy the domain. Search Console DNS record. Bing account                                                                                                         |
| 2        | RPS / Stone Paper Scissors page: how to play and the rules (400 words)                                                                                          |
| 3        | RPS tips and FAQ (300 words), and two title options                                                                                                             |
| 4        | Tic Tac Toe / Zero Kata / XO page (600 words)                                                                                                                   |
| 5        | Chess page with the "no login, play with a friend by link" angle (700 words)                                                                                    |
| 6        | Home page text (200 words)                                                                                                                                      |
| 7        | Read all four texts aloud on a phone and cut anything that sounds like an ad                                                                                    |
| 8        | Hinglish share text for CC-217 (5 short lines). The owner reviews it as a native speaker                                                                        |
| 9        | When CC-123 is live: submit the sitemap and request indexing                                                                                                    |
| 10 to 12 | When Search Console has data: read the queries, rewrite one title with impressions but a click rate under 2%, and add any question people search for to the FAQ |

What not to build: one page per city, one page per opening, or bought links. Google calls these scaled content abuse and link spam (same spam policy source).

---

## 3. Free distribution channels

### 3.1 Two separate launches, both owner decisions

1. **The friends launch** (working agreement item 7).
   - **When:** when the owner decides, after Phase 0, every open security P0, CC-123 and CC-232 are done. CC-217 should ideally be done too, so that every share carries a good card.
   - **Who:** the owner's own friends and their groups.
2. **The public launch.**
   - **When:** a second decision, written in `docs/DECISIONS.md`, after the friends launch has 4 weeks of data and k is known.
   - **What it covers:** community posts, college clubs beyond friends of friends, Product Hunt, Show HN and portals.

### 3.2 Ranked by expected new players per hour of owner effort

**Every number in this table is an unsupported guess.** The owner's own groups are a pool that runs out after one use, not a repeatable rate. Real numbers come from the launch cohort.

| Rank | Channel                                                                   | Players per hour (guess)                                                 | Cost                       | When                                                       |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------- |
| 1    | Owner's own WhatsApp groups with a room link (one-off pool)               | 30 to 50, once                                                           | Free                       | Friends launch                                             |
| 2    | Players sharing result cards on WhatsApp (CC-217)                         | Grows on its own if k is 0.15 or more                                    | Free                       | When CC-217 ships                                          |
| 3    | Owner-hosted "club night" room in a friends group, 21:00 IST              | 5 to 15 a night, and they meet a person                                  | Free                       | Friends launch, weekly                                     |
| 4    | Friends who run a college chess club or hostel group (friend of a friend) | 10 to 25, once per group                                                 | Free                       | Friends launch, weeks 3 and 4                              |
| 5    | PWA home screen icon (CC-148, phase 2)                                    | Not new players, more return visits                                      | Free                       | Phase 2                                                    |
| 6    | Indian Discord servers (#self-promo only) and r/WebGames                  | 2 to 10                                                                  | Free                       | Public launch only                                         |
| 7    | WhatsApp Channel and Telegram channel "ClassiCade Daily"                  | Low until it has followers                                               | Free                       | Only when CC-144 can post the daily puzzle with no writing |
| 8    | Short video (YouTube Shorts, Instagram Reels)                             | Under 2 for the first 20 to 30 posts (general knowledge, low confidence) | Free                       | Phase 2 at the earliest                                    |
| 9    | Product Hunt, AlternativeTo, itch.io link page                            | Under 2 players, but a backlink                                          | Free                       | Public launch, after the domain                            |
| 10   | Show HN                                                                   | 0 to 5 if plain, more only with a novel hook                             | Free                       | Public launch, with a hook                                 |
| 11   | CrazyGames portal edition                                                 | Unknown, US and UK audience                                              | Free, weeks of engineering | Stage 3 at the earliest                                    |
| 12   | Google Play via TWA                                                       | Low without ratings                                                      | US$25 plus 12 testers      | Deferred                                                   |
| 13   | Poki                                                                      | Not applicable                                                           |                            | No                                                         |

### 3.3 Portals, with their real rules

- **Poki (100M+ monthly players). No.**
  - It requires open-web exclusivity (https://developers.poki.com/guide/working-with-poki).
  - It bans outgoing links and our own branding (https://developers.poki.com/guide/requirements-quality).
  - It says "Clones of existing hits ... won't be promoted" (https://developers.poki.com/guide/what-we-look-for).
- **CrazyGames (50M monthly players, mostly US and UK). Stage 3 at the earliest.**
  - What fits: no exclusivity, and we can run our own servers (https://docs.crazygames.com/faq/).
  - What it requires: its login and SDK, no external logins for guests, instant multiplayer, rematch in the same room, its usernames and moderated chat (https://docs.crazygames.com/requirements/multiplayer/, https://docs.crazygames.com/requirements/account-integration/).
  - Basic Launch runs 7 to 21 days with ads off and needs 500 plays (https://docs.crazygames.com/resources/basic-launch-metrics/).
  - **We do not qualify today.** Production sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`, the cookie is SameSite=Lax, and Socket.IO only accepts listed origins.
  - Its audience plays at Indian night, so it should wait until the ADR-029 "find a person" gate is open for those hour slots.
- **itch.io. A free link page only, after the public launch.** We cannot embed the game for the same framing reasons. Browser multiplayer games get little traffic there (general knowledge, medium confidence).
- **Newgrounds and GameDistribution. No.** We could not fetch their rules. GameDistribution syndicates to thousands of third-party sites, which clashes with our origin allowlist and kids safety (general knowledge, medium confidence).

### 3.4 PWA install and Play Store

- **PWA (CC-148, phase 2: "PWA manifest and opt-in web push").**
  - Today `/manifest.webmanifest` returns 404.
  - Chrome needs HTTPS, a manifest with a name, 192px and 512px icons, a start_url and `display: standalone`, plus a tap and 30 seconds of viewing (https://web.dev/articles/install-criteria).
  - On iPhone, only Home Screen web apps can ask for push permission (https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
  - Showing the install button after a first win, not on landing, is an idea for IDEAS.md. The vision §6.9 timing rule covers push permission, not installs.
- **Google Play through a TWA. Not yet.**
  - Cost: US$25 once, plus a government ID and card, proof of an Android device, and 12 testers opted in for 14 days in a row for personal accounts created after 13 Nov 2023 (https://support.google.com/googleplay/android-developer/answer/14151465).
  - The Families policy says the app "must not be a webview of a website" when its audience includes children (https://support.google.com/googleplay/android-developer/answer/9893335). That clashes with "safe for kids by default".
  - Revisit when PWA installs reach about 5% of weekly players. That revisit needs its own decision record.

### 3.5 Cold start and liquidity: where every post must point

Strangers arrive at random hours. With few players, nearly all of them will meet only characters. Rules for every post:

1. **Point only at "challenge a friend" or "beat Rocky".** Never at "play people online". "Beat Rocky" is honest at any hour.
2. **Gather live play into the vision's 19:00 to 23:00 IST busy hours.**
   - The owner's club night is a scheduled private room at 21:00 IST in a friends group.
   - Any later channel post goes out inside that window.
3. **No global-audience channels** (Show HN, Product Hunt, CrazyGames) until the ADR-029 "find a person" gate (60% of searches find a person within 4 s) is open for the hour slots those audiences play in.
4. **WRP will come from friend pairs and groups.** That is why sharing (CC-217) and friend features (CC-139, CC-222, CC-214) matter more than search or launches.

### 3.6 Communities and launches (public launch only)

- **Rules first.** Read each community's rules and post only in self-promo channels.
- **r/chess** is strict about promotion (general knowledge, medium confidence). Offer something of value, such as "free chess against named beginner characters, no signup".
- **Show HN.**
  - Plain multiplayer clones scored 1 to 5 points.
  - Novel twists scored far more: Probabilistic Tic-Tac-Toe 293, webcam neural RPS 196, Ultimate Tic Tac Toe 160 (HN Algolia API, https://news.ycombinator.com/item?id=40635397).
  - Post only once a hook exists, such as the characters with provable fairness (CC-138 with CC-225).
- **Product Hunt** is free and suggests launching at 12:01 am Pacific (https://www.producthunt.com/launch). It reaches a US tech audience, so do it once, for the backlink.

**Pre-burst checklist, before any post that could bring a spike:**

- [ ] CC-123 and CC-232 are live.
- [ ] The Render workspace holds one free service. No preview environments.
- [ ] Hours used this month leave room for the rest of the month.
- [ ] The uptime workflow ran in the last hour, and the repo had a commit in the last 50 days.
- [ ] A conscious decision: add a card to Render with a spend alert, or accept the risk of a month-long suspension.
- [ ] Atlas M0 usage is well under its limits.

### 3.7 Video clips (phase 2 at the earliest)

- **Format:** 15 to 30 second clips such as "Can you beat Rocky?" or "The RPS move most people throw first". Use Hinglish captions and end on the link.
- **What to expect:** usually 20 to 30 or more posts before anything travels (general knowledge, low confidence). That is more time than the owner has, so wait until CC-144 can feed the clips.
- **Rule:** never show a minor or their username.

### 3.8 The WhatsApp challenge loop (CC-217)

- **Evidence.** Wordle grew from about 90 players to more than 300,000 within two months of adding a shareable result, and passed 2 million a week later (https://en.wikipedia.org/wiki/Wordle).
- **The loop:**
  1. A player finishes a match.
  2. They tap the WhatsApp button.
  3. The message carries Hinglish text and a card under 300 KB.
  4. The friend lands in the room as a guest and plays within 10 seconds.
- **No rewards for referrals.** Duolingo's reward referrals added only 3% (cited in PRODUCT_VISION.md), and coin rewards come close to "stakes". CC-149 stays deferred.

### 3.9 Week by week

**Before launch (from now, owner actions only, about 2 hours a week)**

| Week | Owner actions                                                                                                                                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Buy the domain. Search Console DNS record and Bing account (2.2). Check the Render workspace holds one service. Add a free second pinger such as UptimeRobot on a 5 minute check (general knowledge, medium confidence on its free plan. Read its terms first), so one skipped GitHub run does not let the site sleep |
| 2    | RPS page text. Start a private list of 20 to 40 friends and 5 groups to invite                                                                                                                                                                                                                                        |
| 3    | RPS FAQ. Write the club night invite (one paragraph)                                                                                                                                                                                                                                                                  |
| 4    | Tic Tac Toe text. Check the launch conditions in 3.1 against the board                                                                                                                                                                                                                                                |

**After the owner's friends launch decision**

| Week | Owner actions                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1   | Message the friends list personally with a "beat Rocky" link. Host the first club night at 21:00 IST in one group. Write the date in a posting log (date, channel, people messaged) |
| L2   | Read the launch cohort in the CC-233 console: first games, D1. Second club night                                                                                                    |
| L3   | Ask 2 to 3 friends who run a college chess club or hostel group to share their own room link, still word of mouth                                                                   |
| L4   | First weekly review (section 6.2). Compute k. Decide whether to propose a public launch decision. Drop anything that brought fewer than 2 players per hour                          |

---

## 4. From day 1 to day 2

### 4.1 First session design (all existing tickets, in board order)

1. **Land and play.** One tap on "Play Rocky", first move within 10 seconds, no signup (CC-051 with CC-221).
2. **First match is winnable.** CC-150 aims for 65 to 70% player wins in the first 3 sessions, disclosed per ADR-025.
3. **One beat at a time (CC-099 with CC-163).** At most two lines above Rematch. MATCH_EXPERIENCE A9 found that 5 toasts covered 85% of the screen.
4. **Keep the loop short.** Poki says loops of about 3 minutes work best on the web (https://developers.poki.com/guide/engagement).
5. **Make sharing the natural next step (CC-217).** On the web, no installed icon reminds the player to come back. A friend in a WhatsApp group does.

### 4.2 Reasons to return tomorrow, ranked by evidence

1. **A person waiting.** This means a friend's rematch, a "your move" (CC-222) or a circle (CC-214).
   - Learners with a friend streak are 22% more likely to do the daily lesson (correlation, https://blog.duolingo.com/friend-streak/, 5 Aug 2024).
   - Ludo King grew on private rooms with family and friends (https://en.wikipedia.org/wiki/Ludo_King).
   - In phase 1, the no-code version is the owner's weekly club night: people know when others will be there.
2. **One fixed thing tomorrow, the same for everyone.** Wordle's daily puzzle is one example. Another is Chess.com's Daily Puzzle, solved by 1 million people a day from December 2022 (https://www.chess.com/blog/CHESScom/chess-is-booming-and-our-servers-are-struggling). For us that is CC-144 (phase 2).
3. **Winning in the first session (CC-150).** This rank is general knowledge, medium confidence.
4. **A streak, celebrated early.** Going from day 2 to day 3 feels bigger than adding a day to a long streak, and Duolingo's streak animation raised day 7 activity by 1.7% (https://blog.duolingo.com/how-duolingo-streak-builds-habit/, 31 Jan 2022).
5. **One opt-in reminder built from real state.** Duolingo protects the channel by limiting volume (https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth). For us this reaches very few players (4.4).
6. **A rival who remembers.** For example, "Rocky: you lead 2 to 1" (CC-138, CC-221).

**What backfires. We will not do any of these:**

- Asking for permission on page load. A Block is permanent.
- Countdowns, late-night "streak dies soon" alarms, or "about to lose" copy.
- Reward timers and paid skips. Clash Royale removed its chest timers in April 2025 (https://en.wikipedia.org/wiki/Clash_Royale).
- Login rewards, spin wheels, or a signup wall before play.

### 4.3 What works for guests, with no messages at all

Nearly every day-1 player will be a guest who arrived from a WhatsApp link. Their day 2 depends on things that need no reminder:

1. **The friend link.** The friend who sent the link is the reminder. CC-217 makes the reply card good. Until CC-139 ships, a room closes after the rematch window, so "rematch tomorrow" means a new room link sent in the same chat.
2. **A known time.** "Club night every Wednesday 21:00" in the group (owner action).
3. **The streak, kept in the browser.** Guest sessions last 30 days after the last visit (`apps/server/src/service/http/session.js`). The existing SaveProgressCard after a win already invites signup.
4. **A home screen icon** once CC-148 ships (phase 2).
5. **The Tomorrow line** (4.5, an idea for phase 2).

### 4.4 The honest reach of a day-2 reminder

- **Who can get one.** Under ADR-028.1, guests and accounts with no stated birth year are minors, and minors get no reminders. CC-152 (birth year at signup) is phase 2 and still Todo. Until it ships there are **no known adults, so the reminder audience is 0%**.
- **The channels are not built yet.** Push needs CC-148 and CC-215 (phase 2). Email needs an account, CC-123, CC-033 and the domain's DNS records.
- **After those ship, a rough size.** Multiply four shares:
  1. Adults with an account and a stated birth year: 10 to 20% of a cohort (guess).
  2. Of those, players who saw the sheet after a first win: about 60% (guess).
  3. Of those, players who turned it on: 20 to 30%. The only figure we have is native apps, 27.8% on Android (OneSignal 2024), and web may be lower.
  4. Of those, reminders that actually arrive: 70 to 90%, because battery savers on Vivo, Oppo and Xiaomi phones delay push (general knowledge, medium confidence).

  That gives **about 1 to 4% of a day-1 cohort reached** (low confidence). Even a strong lift on those players moves cohort D1 by well under one point.

- **Decision.** Day-2 effort in phase 1 goes to 4.1 and 4.3. Reminders are a phase 2 courtesy for adults who want them, not a growth lever.

### 4.5 The end-of-day-1 screen (exact copy, an idea for phase 2)

**When it shows:** on the result screen of the first counted match of the day, and again when the rematch window ends or the player taps Leave.

```
Day 1 streak started
Tomorrow: Checkmate hunter (+50 XP). New quests at 5:30 am
[ Rematch ]   [ Play again ]
```

Hinglish (CC-218):

```
Day 1 streak shuru
Kal: Checkmate hunter (+50 XP). Naye quests subah 5:30 baje
[ Rematch ]   [ Phir khelo ]
```

**Rules for the copy:**

- **A clock time, never a countdown.** Today's daily panel shows "Resets in 5h 12m". This screen must not copy that.
- **What "tomorrow" means.** `questsFor.js` picks quests per UTC day, so "tomorrow" is the next UTC day. The time shown is the browser's local time for the next UTC midnight, which is 5:30 am in India. When CC-146 ships, both switch to the local day.
- **Real quests.** The preview calls `questsFor` with tomorrow's day, so it shows real quests with no new storage.
- **What the Tomorrow line says, in priority order:**
  1. A friend: "Riya leads 3 to 2. [Send to Riya]". This opens WhatsApp with the CC-217 card.
  2. Phase 2: "Tomorrow's puzzle: mate in 2".
  3. The default: tomorrow's first quest.
- **Guests after a win.** The existing SaveProgressCard stays below, with one line: "Your Day 1 streak is saved in this browser. Sign up to keep it on any device."
- **"Remind me" button.** It shows only to **adults with a stated birth year**, only after a **first win** (vision §6.9: a first win, a streak of 3 or a friend's move), and only once CC-148 and CC-215 exist.

**The "Remind me" sheet.** This is our own pre-prompt, shown only after a tap. Its wording matches exactly what we send:

> A daily reminder at about 8:40 pm, at most one a day, only on days you haven't played. Never at night. Turn it off from the message itself.
> [Turn on] [Not now]

Hinglish:

> Roz shaam lagbhag 8:40 baje ek reminder, din mein ek se zyada nahi, sirf jis din tumne nahi khela. Raat ko kabhi nahi. Message se hi band kar sakte ho.
> [Haan, yaad dilao] [Abhi nahi]

**How the sheet works:**

- **Time:** the hour of this session, kept between 18:30 and 21:30.
- **Android Chrome:** the browser's prompt runs only after "Turn on".
- **iPhone:** the sheet says "Add to Home Screen to get reminders".
- **Account holders** may choose email instead, once CC-033 exists.
- **After "Not now":** wait 7 days, and ask at most twice ever.

### 4.6 The day-2 welcome back (an idea for phase 2)

1. **Landing.** The home page shows a Today block first:
   ```
   Welcome back. Day 2
   [ Continue: Checkmate hunter vs Queen Vee ]
   ```
   - If a friend's game is waiting, the button reads "Rematch Riya" instead. One tap, first move within 10 seconds.
   - Hinglish: "Wapas aa gaye. Day 2" / "[ Aage khelo: Checkmate hunter vs Queen Vee ]".
2. **First day-2 result.** Show "Day 2. Back again" as its own beat, then quest progress, then the Tomorrow line for day 3.
3. **For adults who turned the reminder on:**
   - The reminder goes out only on days they haven't played.
   - After 3 ignored, it drops to once a week.
   - After 7 ignored, it stops, and one inbox item asks "Reminders paused. Turn back on?"
   - **There is no "new this week" message for lapsed players.** That would be marketing nobody asked for.
4. **Cold start guard.** CC-232 must be live before any reminder ships. The reminder link opens a light page.

---

## 5. Notifications and email policy

This section should become a new ADR, "Notification channels and caps". It must be written and accepted before CC-147, CC-148 or CC-215 start (all phase 2). It is a decision record, not a ticket.

### 5.1 Channels and costs

| Channel                            | Cost                                                                                                                                                                                                                                                          | Needs first                                                                  | Use                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| In-app inbox and badge (CC-147)    | Free                                                                                                                                                                                                                                                          | Nothing                                                                      | Everything. This is the record of truth                                                                 |
| Web push (CC-148)                  | Free (browser push services, the `web-push` npm library, VAPID keys)                                                                                                                                                                                          | Manifest and service worker (both 404 today). On iPhone, Home Screen install | Your move, challenge and rematch for adults. The opt-in daily reminder for adults                       |
| Email                              | Free tiers: Resend 3,000 a month and 100 a day (https://resend.com/pricing), Mailjet 6,000 a month and 200 a day (https://www.mailjet.com/pricing/). Paid later: Resend Pro US$20 a month, Amazon SES US$0.10 per 1,000 (https://aws.amazon.com/ses/pricing/) | Domain (CC-123) with SPF, DKIM and DMARC records                             | Password reset (CC-033). An opt-in weekly recap only after the postal address question is settled (5.9) |
| WhatsApp share links (CC-217)      | Free                                                                                                                                                                                                                                                          | Nothing                                                                      | The player sends them. We never send                                                                    |
| WhatsApp Channel, Telegram channel | Free                                                                                                                                                                                                                                                          | An owner account                                                             | Only once CC-144 can feed a daily post with no writing                                                  |
| WhatsApp Business messages         | Paid. About ₹0.95 to ₹0.97 per marketing message plus ₹2,799 a month for a plan (https://www.interakt.shop/pricing/). Meta charges per message since 1 Jul 2025 (https://developers.facebook.com/docs/whatsapp/pricing/)                                      | Meta verification, phone numbers, opt-in                                     | **Not now.** 500 players × 1 a day × 30 days × ₹0.97 ≈ ₹14,550, plus the plan ≈ ₹17,350 a month         |
| SMS                                | Paid. ₹0.16 to ₹0.25 per SMS plus 18% GST (https://www.msg91.com/pricing/sms), plus TRAI DLT registration (fee not confirmed)                                                                                                                                 | DLT entity, header and templates                                             | **Never** for engagement                                                                                |

**Gmail's sender rules** (https://support.google.com/a/answer/81126):

- From 1 Feb 2024, every sender needs SPF or DKIM, valid DNS, TLS and a spam rate below 0.3%.
- Bulk senders also need an aligned DMARC and one-click unsubscribe.
- We set up all of it from the first email, even below the bulk threshold.

**The reminder clock (an idea for phase 2).**

- A sleeping Render instance cannot run timers, and GitHub schedules can run late or not at all.
- So the tick endpoint never assumes it runs at an exact time. Each call reads the clock, sends whatever is due and not yet sent, and records it in a notification log with a per-player `lastSentAt`, so a message can never go out twice.
- Two independent callers (the GitHub schedule and the free external pinger) can both trigger it safely.
- A check alerts the owner when no tick has run for an hour.

### 5.2 Channels per persona and age

| Who                                                         | What they can get                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Riya** (adult with a stated birth year, college, Android) | Push for your move, challenges and rematches. The opt-in daily reminder. Email for password reset                                                              |
| **Meena** (adult parent, family phone)                      | Push for challenges in the family circle. Children on the same phone use pass and play (CC-223) and receive nothing                                            |
| **Drop-in searcher or guest** (unknown age, so a minor)     | **Inbox only.** No push, no email                                                                                                                              |
| **Minor** (stated under 18)                                 | **Inbox only** until ADR-028.9's verifiable parental consent step ships and the lawyer confirms that "your move" pushes count as a service the minor asked for |

**Why guests and minors get no push at all.**

- A push subscription stores an endpoint, a time zone and a log for that player. Under DPDP §9, processing a child's data needs verifiable parental consent.
- Guests count as minors under ADR-028.1.
- So even the "Tell me when they move" push stays off for guests and minors. That consent step ships before 13 May 2027 (ADR-028.9).

**No exam-season rule.** Minors and unknown ages already get nothing unasked, and we do not guess who is a student or a parent.

### 5.3 Permission strategy

- **Never on arrival.** Our own sheet comes first, and the browser prompt runs only if the player says yes (https://web.dev/articles/push-notifications-permissions-ux, https://www.nngroup.com/articles/push-notification/).
- **Moments of value** (vision §6.9): a first win, a streak of 3, or a friend's move.
- **Ask at most twice ever,** with 7 days between asks.
- **Benchmarks, labelled honestly:**
  - Chrome's figure of 6.69% Allow for cold prompts is **Windows desktop** (https://developer.chrome.com/blog/permissions-chip).
  - OneSignal's 27.8% (Android) and 20.6% (iOS) game opt-in rates are **native apps** (https://onesignal.com/mobile-app-benchmarks-2024).
  - Neither is a benchmark for web push on Android. We measure our own opt-in among adults who saw our sheet.
- **No real-time promise.** Battery savers on Vivo, Oppo and Xiaomi delay background push (general knowledge, medium confidence). Copy says "we'll let you know", never "instantly".

### 5.4 The exact caps

| Kind                                                                        | Default                             | Cap                                                                                                                                           |
| --------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Asked for** (your move, challenge, rematch, friend accepted). Adults only | On, once push is allowed            | 1 per opponent per 15 minutes. 10 a day at most. Bundled when 3 or more are waiting. No push while the tab is open                            |
| **Not asked for** (daily puzzle ready, streak reminder)                     | **Off** until the adult turns it on | **1 a day and 4 a week.** Only on days the player has not played. After 3 ignored, once a week. After 7 ignored, stop and show one inbox item |
| **Email recap** (when allowed, 5.9)                                         | Off. Double opt-in                  | 1 a week, only if something happened. **It counts as that day's unasked contact**                                                             |
| **All channels together**                                                   |                                     | **At most 1 unasked contact a day**                                                                                                           |

**Asked-for messages are not reminders.** They are replies to something the player started, like a turn in a game they chose to play. They do not count against the vision's "at most one reminder a day" promise. The 10 a day ceiling and bundling are there so they can never turn into a flood.

**On recap day there is no reminder push.** Sunday's recap uses up that day's unasked slot.

### 5.5 Quiet hours and timing

- **Time zone:** stored per player from `Intl.DateTimeFormat().resolvedOptions().timeZone` (CC-146). When it is unknown, use India time.
- **Send window:** 18:30 to 21:30 local by default. An adult's reminder may follow their usual play hour (the median of the last 14 days), kept inside 08:00 to 21:30.
- **Quiet hours:** 22:00 to 07:00. Adults may change them (CC-215).
- **Inside quiet hours:** a due message waits in the inbox. It is never pushed later in a burst.

### 5.6 Priority rules

**Asked for, outside the daily cap:**

1. A friend's move, challenge or rematch.

**Unasked, competing for the one daily slot (the highest wins, the rest are dropped):**

2. The daily puzzle is ready (CC-144, opted in).
3. A streak reminder (opted in).
4. The weekly recap (email).

**"Someone is free to play" (CC-226) is not in the list and has no template.** It stays off until the ADR-029 "find a person" gate (60% of searches matched within 4 s) is open for that hour slot. When it opens:

- It sends only while a real person is still searching.
- If the match has gone by the time the player taps, they land on a character with an honest "They found a game. Play Rocky?"

### 5.7 Opt-out in one tap

- **Push.** Every reminder carries a "Stop daily reminders" action button.
  - The Notification API `actions` field works on Chrome for Android and desktop (general knowledge, high confidence).
  - It switches the category off at once, and the confirmation goes to the inbox, not another push.
- **Email.** A `List-Unsubscribe` header with one-click POST, plus a visible link. Both work immediately, well within CAN-SPAM's 10 business days.
- **Settings.** One switch per channel and per type (CC-215).

### 5.8 Consent records

For every consent we store:

- the player id, channel and type,
- the exact wording shown and its version,
- a timestamp and the source screen,
- the withdrawal timestamp.

Withdrawing must be as easy as giving. Email consent is double opt-in. We collect **no phone numbers**.

### 5.9 Legal basis

- **India, DPDP Act 2023.** Commencement was notified on 13 Nov 2025. Some provisions start on 13 Nov 2026, and all remaining provisions on 13 May 2027 (https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Act,_2023).
  - Consent must be free, specific, informed and withdrawable. That is why the sheet's wording matches exactly what we send.
  - The Act bars tracking, behavioural monitoring and targeted advertising aimed at under-18s, and processing a child's data needs verifiable parental consent. Hence 5.2.
  - Penalties go up to ₹250 crore (general knowledge, high confidence).
- **EU, GDPR plus ePrivacy.** Marketing email needs prior opt-in, and double opt-in is the standard proof (general knowledge, high confidence).
- **US, CAN-SPAM.**
  - Password reset is transactional and mostly exempt.
  - A recap is commercial. It needs a working opt-out honoured within 10 business days, honest headers and **a physical postal address** (https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business). Penalties reach US$53,088 per email.
  - A solo owner must not publish a home address. Options are a post office box or a virtual office address, both **paid** (general knowledge, low confidence on cost: a few hundred to a few thousand rupees a year for a PO box, more for a virtual office).
  - **Decision: no recap email until the owner has a non-home address.** The weekly recap lives in the inbox instead.
- **Dark patterns.** Every template and screen in this plan goes through CC-229 (the audit against India's CCPA 2023 dark pattern guidelines) before web push ships. Two lines need a special look as possible false urgency: "Day 2 is one match away" and "Day 5 streak. 1 freeze saved".

### 5.10 Message templates

- **Rotate.** Never repeat a template within 7 days. Duolingo found a template loses effect when repeated (https://research.duolingo.com/papers/yancey.kdd20.pdf, medium confidence on the exact metrics).
- **Short.** Keep each one under about 60 characters.
- **Straight to the action.** Every link opens straight into the action.
- **Adults only.** Every template below goes to adults only, per 5.2.

| Type                          | English                                         | Hinglish                                     |
| ----------------------------- | ----------------------------------------------- | -------------------------------------------- |
| Your move                     | Rohan moved. Your turn (Chess)                  | Rohan ne chaal chali. Ab tumhari baari       |
| Challenge                     | Priya challenged you to Tic Tac Toe             | Priya ne Tic Tac Toe ka challenge diya       |
| Rematch                       | Priya wants a rematch                           | Priya ko rematch chahiye                     |
| Bundle                        | 3 games are waiting for your move               | 3 games mein tumhari chaal baaki hai         |
| New quests                    | Your new quests are in: Checkmate hunter +50 XP | Naye quests aa gaye: Checkmate hunter +50 XP |
| Day 2 (CC-229 to check)       | Day 2 is one match away                         | Day 2 bas ek match door hai                  |
| Daily puzzle                  | Today's chess puzzle is ready. Mate in 2        | Aaj ka puzzle ready hai. 2 chaal mein mate   |
| Streak (CC-229 to check)      | Day 5 streak. 1 freeze saved                    | 5 din ki streak. 1 freeze bacha hai          |
| Character rival               | Rocky has a new trick. Rematch?                 | Rocky ne naya trick seekha hai. Rematch?     |
| Reminders paused (inbox only) | Reminders paused. Turn back on?                 | Reminders band hain. Phir se chalu karein?   |

**Weekly recap (inbox now, email only after 5.9 is settled)**

- **Subject:** "Your week on ClassiCade: 12 games, 2 new badges" / "ClassiCade par tumhara hafta: 12 games, 2 naye badges".
- **Body:** the week's stats, one suggested challenge as a button, "You get this because you turned on the weekly recap", a one-click unsubscribe and the postal address.

**Double opt-in email**

- **Subject:** "Confirm your weekly ClassiCade recap".
- **Body:** "Tap to confirm. One email a week, and only when something happened. Didn't ask for this? Ignore it and nothing will be sent."

**Banned copy:**

- "We miss you" and guilt messages.
- Countdowns, "about to lose", "don't break".
- A sad mascot.
- Fake "friends are waiting".
- "Someone is free" before its gate opens.
- Anything unasked to minors or unknown ages.

---

## 6. Measurement

### 6.1 The funnel and how to measure each step for free

| Step                          | Measured with                                                                                                                                                                                     | Available                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Search impressions and clicks | Search Console Domain property and Bing Webmaster Tools                                                                                                                                           | After CC-123 is live, with data 2 to 4 weeks later |
| Visit                         | `page_view` from first-party telemetry (CC-174, CC-175)                                                                                                                                           | Phase 1, top 10 item 5                             |
| First move                    | `gameplay_start` and time to first move (CC-220)                                                                                                                                                  | Same                                               |
| Finished game                 | Match history in MongoDB, shown in the owner console (CC-233)                                                                                                                                     | **CC-233 is in progress**                          |
| D1 and D7                     | The CC-233 console's day 1 and day 7 cohorts                                                                                                                                                      | With CC-233                                        |
| WRP                           | Players with real play in two different weeks, in CC-233. Later from nightly totals (CC-176) on the dashboard (CC-177)                                                                            | With CC-233                                        |
| Channel                       | **Now:** the owner's posting log (date, channel, people messaged) set against new players per day in CC-233. One channel a day keeps it readable. **Later:** a `ref` parameter on links (an idea) | Now                                                |
| Shares and k                  | Shares from CC-217 and new players arriving by room links                                                                                                                                         | With CC-217 and CC-174                             |
| Notifications                 | Notification log: sent, opened, opted out, ignored. Opt-in among adults who saw the sheet                                                                                                         | Phase 2                                            |

Telemetry follows CC-173. It is first party, anonymous, opt-out, honours GPC, and keeps only aggregate counts for minors. We use no third-party analytics.

### 6.2 Weekly review for the owner (Monday, 20 minutes)

1. **Players:** new players, first games and finished games last week (CC-233).
2. **Retention:** D1 and D7 for last week's cohort, and WRP. Compare with the floors in 1.3.
3. **Channels:** new players on each posting log day. Divide by the hours spent and drop the worst channel.
4. **Search** (once live): clicks, impressions, top queries, crawl errors.
5. **Hosting:**
   - Render hours used and bandwidth.
   - The uptime workflow is still enabled (and the repo had a commit in the last 50 days).
   - The external pinger is green.
6. **Log it:** one line in `docs/PROGRESS.md` with the numbers and the single change for next week.

---

## 7. Plan

### 7.1 Existing tickets that matter for growth, in the board's own order (no new scope)

Phase 0 comes first and blocks launch: CC-105, CC-107, CC-116, CC-117, CC-118, CC-122, and PRs #51 (CC-180, CC-181, CC-182) and #53 (CC-162, CC-164, CC-170). Security is P0. Sizes below are the growth lead's estimates.

| Board order       | Ticket (scope as written on the board)                                                                  | Size | Owner action                                                         | Growth effect                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| In progress       | **CC-233** owner analytics console (includes day 1 and day 7 cohorts)                                   | M    | Use it weekly                                                        | Our only D1 and D7 numbers in this window                                                   |
| Top 10, #1        | **CC-123** brand domain, redirect from onrender, ALLOWED_ORIGINS                                        | S    | **Buy the domain, ₹800 to ₹1,500 a year (paid)**                     | Every share and link builds on the final host. Makes Search Console and email possible      |
| Top 10, #1        | **CC-232** cold start loading screen                                                                    | S    | Ask the builder about the status code crawlers see                   | Fewer lost players on cold starts                                                           |
| Top 10, #2 and #3 | **CC-138 with CC-225, CC-051 with CC-221** characters and "Play Rocky"                                  | L    | None                                                                 | Playing in 10 s at any hour. The honest post target                                         |
| Top 10, #5        | **CC-045, CC-173 to CC-177, CC-220, CC-228** telemetry and liquidity gates                              | L    | None                                                                 | The funnel, and the gates that unlock CC-226 and the global channels                        |
| Top 10, #6        | **CC-099 with CC-163** one beat at a time                                                               | M    | None                                                                 | A clean first win                                                                           |
| Top 10, #7        | **CC-217** WhatsApp share cards under 300 KB, WhatsApp button, Hinglish text                            | S    | **Write and review the Hinglish text**                               | The main free growth loop                                                                   |
| Top 10, #8        | **CC-146, CC-145** local days, freezes                                                                  | M    | None                                                                 | Correct "tomorrow" everywhere                                                               |
| Top 10, #9        | **CC-144** daily set                                                                                    | M    | None                                                                 | The proven daily ritual. Unlocks the daily Channel                                          |
| Top 10, #10       | **CC-152**, then CC-139, CC-052, CC-214                                                                 | L    | None                                                                 | Known adults (the reminder audience), persistent challenges, friends, circles               |
| Phase 1, P2       | **CC-216** server-rendered game page content                                                            | M    | **Write the page text (2.7)**                                        | Makes ranking possible. If the owner wants search sooner, moving it up is an owner decision |
| Phase 1           | **CC-223** pass and play                                                                                | M    | None                                                                 | Family play for Meena                                                                       |
| Phase 2           | **CC-147, CC-148, CC-215, CC-229** inbox, PWA and push, preferences and quiet hours, dark pattern audit | L    | **Accept the notification ADR first**                                | "Not too much, not too little", enforced in code                                            |
| Phase 2           | **CC-033** password reset email                                                                         | S    | **Resend account (free). SPF, DKIM, DMARC records at the registrar** | Accounts become safe to rely on                                                             |
| Phase 2           | **CC-218** Hinglish string catalogue                                                                    | M    | Review the copy                                                      | Fits Riya and Meena                                                                         |
| Phase 2           | **CC-222** turn-based play                                                                              | L    | None                                                                 | "Your move", a person waiting                                                               |
| Phase 2, gated    | **CC-226** "ping me when a person is free"                                                              | M    | None                                                                 | Only after the ADR-029 gate for that slot                                                   |

### 7.2 Ideas for `docs/IDEAS.md` (names only, no numbers, not started)

Rows to paste into the IDEAS.md table (Date 2026-10-17, From: growth plan).

| Idea                                                                                                              | Size | Owner action                          | Expected effect                                              |
| ----------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------- | ------------------------------------------------------------ |
| Result screen "Tomorrow" line with a `questsFor` tomorrow preview, clock time not countdown, UTC day until CC-146 | S    | Approve when the freeze lifts         | A visible reason to return for every player, guests included |
| Channel attribution: a `ref` parameter on posted and shared links, recorded with `gameplay_start`                 | S    | None                                  | Replaces the posting log                                     |
| JSON-LD on home and game pages (WebSite, Organization, BreadcrumbList, VideoGame with WebApplication), no ratings | S    | None                                  | Site name and clearer meaning for search                     |
| Sitemap `lastmod` and an IndexNow ping on deploy                                                                  | XS   | None                                  | Faster Bing indexing                                         |
| Install button after a first win (timing on top of CC-148)                                                        | XS   | None                                  | More home screen icons                                       |
| Reminder tick: clock-reading, idempotent, two callers, an alert when ticks stop                                   | M    | A GitHub Actions secret               | Reminders that survive a sleeping server and skipped runs    |
| "Remind me" sheet after a first win, adults only, wording as in 4.5                                               | S    | None                                  | A courtesy for the 1 to 4% who want it                       |
| A monitor that alerts on skipped or disabled uptime runs                                                          | XS   | None                                  | No silent sleep                                              |
| English rules sections first, Hindi pages later with a native review and hreflang                                 | M    | **A native Hindi reviewer**           | Hindi rules searches                                         |
| Portal edition for CrazyGames (token auth, origins, CSP), with its own ADR                                        | L    | Approve at Stage 3                    | Portal players for matchmaking                               |
| Play Store TWA with a 13+ listing, with its own ADR                                                               | M    | **US$25, ID, 12 testers for 14 days** | Play Store search                                            |

### 7.3 Decisions for the owner (written in `docs/DECISIONS.md`, not tickets)

1. **The notification channels and caps ADR** (section 5), before any phase 2 notification work.
2. **The friends launch date**, after Phase 0 and the security P0s.
3. **The public launch**, after 4 weeks of friends data.
4. **The phase 2 retention gate**, from our own 4 weeks of data and web benchmarks.
5. **Card on Render or not**, before any burst post.
6. **A non-home postal address**, before any recap email.

---

## 8. Risks and mitigations

| Risk                               | What could go wrong                                                                                                                                                                                                  | Mitigation                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Breaking the working agreement** | Growth work sneaks in as new feature scope during the freeze                                                                                                                                                         | Only owner actions and written ticket scope count as "now". Everything else goes to IDEAS.md                                                                                           |
| **Spam and reputation**            | Too many messages wear out the channel. Groupon went to 5 emails a day and lost the channel (https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth). Community bans. The email domain marked as spam | Caps in 5.4 enforced in code. Changing them needs an ADR. Alert when opt-outs pass 2% of sends. Post only where the rules allow. SPF, DKIM, DMARC, double opt-in. Spam rate under 0.1% |
| **Search penalties**               | Thin or mass-produced pages, machine translation, fake ratings                                                                                                                                                       | Hand-written English pages only. No Hindi without a native review. No aggregateRating without real ratings. No bought links (Google spam policies)                                     |
| **Portal and store rules**         | Poki exclusivity, CrazyGames login rules, Play's Families webview ban                                                                                                                                                | Skip Poki. CrazyGames and Play each wait for their own ADR and real demand                                                                                                             |
| **Privacy**                        | Consent not provable, phone numbers collected, telemetry that identifies people                                                                                                                                      | Consent records (5.8). No phone numbers. CC-173 policy. Legal review before 13 Nov 2026 and 13 May 2027                                                                                |
| **Minors**                         | A child gets a push or marketing message, or a child's name shows on a card                                                                                                                                          | Guests and minors get inbox only until parental consent ships and the lawyer confirms. Cards never show minor or guest names (ADR-028.7). CC-229 before push                           |
| **Empty rooms for strangers**      | Public posts send people at hours when nobody is online, and they leave                                                                                                                                              | Posts point only at "beat Rocky" or "challenge a friend". Club nights at 21:00 IST. Global channels wait for the ADR-029 gates                                                         |
| **Uptime ping fails**              | GitHub skips runs or disables the workflow after 60 days without a commit. The site sleeps, crawlers see errors, players see a cold start                                                                            | A free external pinger as a second caller. Check the workflow in the weekly review. CC-232 covers the cold start                                                                       |
| **Hours headroom of 6**            | A preview environment or a second service suspends production for the month                                                                                                                                          | One service per workspace, checked weekly and in the pre-burst checklist                                                                                                               |
| **Bandwidth**                      | A spike passes the allowance (about 100 GB, medium confidence)                                                                                                                                                       | About 200,000 first visits of headroom at today's page weight. Card decision before a burst. Share images under 300 KB                                                                 |
| **Push delays**                    | Battery savers on Vivo, Oppo and Xiaomi delay "your move"                                                                                                                                                            | No real-time promise. The inbox is the record of truth                                                                                                                                 |
| **Owner burnout**                  | Content, outreach, reviews and legal work pile on top of Phase 0 and the builders                                                                                                                                    | 2 to 3 hours a week cap. No daily Channel until CC-144 feeds it. No Hindi pages, no video in this window. Drop the worst channel every Monday                                          |
| **Cultural and legal edges**       | Referral rewards look like stakes under the Online Gaming Act. Predictions on real cricket matches                                                                                                                   | No cash or coin rewards. Themes only, never predictions                                                                                                                                |
| **Wrong targets**                  | Mobile app gates make a web launch look like a failure                                                                                                                                                               | Cohort targets from our own data, and the gate decision after 4 weeks                                                                                                                  |

---

## Appendix A. Answers to review

1. **Working agreement. Fixed.**
   - The plan is `docs/GROWTH.md`.
   - "Now" means only owner actions that need no code, plus scope written on ticket titles.
   - Every added scope item moved to section 7.2 (IDEAS.md): JSON-LD, lastmod, IndexNow, verification tags, the cap engine as new code, install timing, and `ref`.
   - SPF, DKIM and DMARC are now owner DNS actions at CC-033 time, not CC-123 scope.
   - Search Console verification now uses DNS on the bought domain, so no code is needed.
   - Section 7.1 follows the board's order, with Phase 0 and security first.
   - Public posting beyond friends needs a separate owner launch decision, after Phase 0 and the security P0s.
2. **ID collisions. Fixed.**
   - All reserved numbers were removed, and proposals are named only.
   - The duplicate cohort query was dropped in favour of CC-233, which is in progress and already has day 1 and day 7 cohorts.
   - The ADR proposals carry names, not numbers.
3. **Reminder reach. Fixed.**
   - Section 4.4 states that the audience is 0% until CC-152 ships and the player is an adult with an account. It sizes the reach later at about 1 to 4% of a cohort (low confidence).
   - Day-2 effort moved to things that work for guests (4.3).
   - The "D1 lift among opted-in" claim was dropped.
4. **Tomorrow line and sheet. Fixed.**
   - The line shows a clock time ("New quests at 5:30 am"), not a countdown.
   - "Tomorrow" is the UTC day until CC-146 ships.
   - The trigger is a first win.
   - Push and the reminder stay in phase 2, after the inbox (CC-147 then CC-148).
5. **Consent wording. Fixed.**
   - The sheet now promises exactly what is sent: "A daily reminder ... at most one a day, only on days you haven't played."
   - The lapsed-player "new this week" message was dropped.
6. **CC-226 liquidity trap. Fixed.**
   - It is behind the ADR-029 "find a person" gate for its hour slot.
   - It sends only while a person is still searching, and a tapper whose match has gone lands on a character.
   - Its template was removed.
7. **Cold start and liquidity. Fixed.**
   - Section 3.5 says every post points to "challenge a friend" or "beat Rocky", and live play gathers at 21:00 IST club nights.
   - HN, Product Hunt and CrazyGames wait for the gates.
   - The plan states that WRP will come from friend pairs.
8. **Inflated targets. Fixed.**
   - The targets are now launch cohort targets (100 to 300 players).
   - Growth continues only when k is 0.15 or more.
   - Every channel number is labelled a guess, and the owner's groups are labelled a one-off pool.
   - Mood Indigo and fest season were removed.
   - D1 and D7 targets match the vision's phase 1 guesses, so the plan no longer plans to miss its own gate.
   - The phase 2 gate change is now an owner decision record based on our own data and the web benchmark (CrazyGames), not a docs ticket.
   - Exam season, medium confidence, was noted when the fest claim was dropped.
9. **Minors and legal. Fixed.**
   - Guest and minor push are off until the ADR-028.9 parental consent step and the lawyer's confirmation (5.2).
   - The exam-season rule was dropped, with the reason given.
   - A CAN-SPAM postal address is paid. The recap email waits for a non-home address and lives in the inbox until then.
   - The Chrome figure is labelled Windows desktop and the OneSignal figure is labelled native apps.
10. **Infrastructure. Fixed.**
    - Section 1.1 states that the GitHub schedule is best effort and that public repos lose schedules after 60 days without activity.
    - It adds a second free pinger and a weekly check.
    - The reminder tick reads the clock, is idempotent and has two callers and an alert.
    - The 6 hour headroom is stated.
    - Bandwidth is quantified: about 100 GB (medium confidence), about 200,000 first visits.
    - The battery saver delay is stated, with no real-time promise.
11. **Quick-win order. Fixed.**
    - The domain is bought in week 1, and no posting happens before CC-123 and CC-232 are live.
    - Shrinking the share images and the `wa.me` button are listed inside CC-217's written scope.
    - One correction to the critique: they are cheap, but they ship when CC-217 comes up (top 10 #7). The plan does not jump the board for them.
12. **Owner time. Fixed.**
    - Growth work is capped at 2 to 3 hours a week.
    - The content plan is about 1 hour a week, in English only.
    - The Hindi pages were cut, with the machine translation warning.
    - The daily Channel waits for CC-144.
    - Video waits.
    - The weekly review is 20 minutes.
13. **Smaller inconsistencies. Fixed.**
    - The share image target is under 300 KB, as CC-217 says.
    - The plan states that asked-for messages do not count against the one-reminder promise.
    - "Day 2 is one match away" and "Day 5 streak. 1 freeze saved" are flagged for CC-229.
    - The recap counts as the day's unasked contact, so no reminder push goes out on recap day.

## Appendix B. Research sources

All fetched on 17 Oct 2026 unless a date is shown.

| Source                                                                                                                                   | Date                            | Supports                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| https://render.com/docs/free                                                                                                             | fetched 17 Oct 2026             | Sleep after 15 min, about 1 min wake, 750 hours, suspension on overage                                                                                                  |
| https://render.com/docs/custom-domains                                                                                                   | fetched 17 Oct 2026             | Free custom domains with TLS, disabling onrender gives 404                                                                                                              |
| docs/DEPLOYMENT.md and .github/workflows/uptime.yml (repo)                                                                               | 17 Oct 2026                     | Uptime ping every 10 min on GitHub Actions, best effort, 60 day inactivity                                                                                              |
| CLAUDE.md working agreement, docs/BACKLOG.md, docs/DECISIONS.md (ADR-028, ADR-029), docs/PRODUCT_VISION.md §4.2, §6.9, §7.2, §8.3 (repo) | 17 Oct 2026                     | Freeze, launch rule, board order, next free ID, minors, gates, vision targets                                                                                           |
| apps/server/src/domain/gamification/questsFor.js, apps/server/src/service/http/session.js (repo)                                         | 17 Oct 2026                     | Quests per UTC day, 30 day rolling sessions                                                                                                                             |
| curl of nocapgaming.onrender.com pages, robots.txt, sitemap.xml, manifest, OG images                                                     | 17 Oct 2026                     | Empty body, 11 URL sitemap, no manifest, image sizes, CSP and framing headers                                                                                           |
| https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics                                             | 4 Mar 2026                      | Server rendering advised, not all bots run JS                                                                                                                           |
| https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering                                                 | 10 Dec 2025                     | Dynamic rendering is a workaround                                                                                                                                       |
| https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap                                                       | 8 Jul 2026                      | lastmod rules                                                                                                                                                           |
| https://developers.google.com/search/docs/crawling-indexing/http-network-errors                                                          | 4 Feb 2026                      | 5xx slows crawling and drops URLs                                                                                                                                       |
| https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes                                                   | 20 Aug 2026                     | Site move steps, weeks of churn, keep redirects a year                                                                                                                  |
| https://developers.google.com/search/docs/fundamentals/seo-starter-guide                                                                 | 10 Dec 2025                     | Domain keywords have hardly any effect                                                                                                                                  |
| https://developers.google.com/search/docs/appearance/site-names                                                                          | 10 Dec 2025                     | WebSite structured data for site names                                                                                                                                  |
| https://developers.google.com/search/docs/appearance/structured-data/software-app                                                        | 8 Sep 2026                      | Software app rich result needs ratings                                                                                                                                  |
| Google FAQPage documentation and changelog                                                                                               | entries 14 Sep 2023, 8 May 2026 | FAQ rich results gone from 7 May 2026                                                                                                                                   |
| https://developers.google.com/search/docs/specialty/international/localized-versions                                                     | 21 Sep 2026                     | Reciprocal hreflang                                                                                                                                                     |
| https://developers.google.com/search/docs/essentials/spam-policies                                                                       | 28 Aug 2026                     | Scaled content abuse, link spam                                                                                                                                         |
| https://publicsuffix.org/list/public_suffix_list.dat                                                                                     | fetched 17 Oct 2026             | onrender.com is a public suffix                                                                                                                                         |
| https://www.indexnow.org/documentation                                                                                                   | fetched 17 Oct 2026             | IndexNow engines, not Google                                                                                                                                            |
| https://ahrefs.com/blog/how-long-does-it-take-to-rank/                                                                                   | 15 May 2025                     | 1.74% to 6.11% of new pages reach top 10 in a year                                                                                                                      |
| suggestqueries.google.com (gl=in), DuckDuckGo, Bing (cc=IN)                                                                              | 17 Oct 2026                     | Demand seen and difficulty                                                                                                                                              |
| papergames.io, bloob.io/rps, poki.com tic tac toe pages (curl)                                                                           | 17 Oct 2026                     | Word counts of ranking pages                                                                                                                                            |
| https://web.dev/articles/vitals                                                                                                          | 31 Oct 2024                     | Core Web Vitals thresholds                                                                                                                                              |
| https://gs.statcounter.com (vendor and screen share, India)                                                                              | September 2026                  | Android share, 360x800, top vendors                                                                                                                                     |
| https://bestbroadbanddeals.co.uk/mobiles/worldwide-data-pricing/                                                                         | 2023 data, fetched 17 Oct 2026  | USD 0.16 per GB in India                                                                                                                                                |
| https://developers.poki.com/guide/working-with-poki, /requirements-quality, /what-we-look-for, /engagement                               | fetched 17 Oct 2026             | Exclusivity, no links, no clones, web players return less, 3 minute loops                                                                                               |
| https://docs.crazygames.com/faq/, /requirements/multiplayer/, /requirements/account-integration/, /resources/basic-launch-metrics/       | fetched 17 Oct 2026             | Portal rules, Basic Launch, 10 to 15% D1 "strong"                                                                                                                       |
| https://web.dev/articles/install-criteria                                                                                                | fetched 17 Oct 2026             | PWA install criteria                                                                                                                                                    |
| https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/                                                                   | 16 Feb 2023                     | iOS push only for Home Screen apps                                                                                                                                      |
| https://support.google.com/googleplay/android-developer/answer/14151465 and /6112435                                                     | fetched 17 Oct 2026             | US$25, 12 testers for 14 days                                                                                                                                           |
| https://support.google.com/googleplay/android-developer/answer/9893335                                                                   | fetched 17 Oct 2026             | Families policy bans webviews                                                                                                                                           |
| https://news.ycombinator.com/item?id=40635397 and the HN Algolia API                                                                     | fetched 17 Oct 2026             | Show HN scores for clones versus twists                                                                                                                                 |
| https://www.producthunt.com/launch                                                                                                       | fetched 17 Oct 2026             | Free, 12:01 am Pacific                                                                                                                                                  |
| https://developers.facebook.com/docs/sharing/webmasters/images/                                                                          | fetched 17 Oct 2026             | OG image size and tags                                                                                                                                                  |
| https://en.wikipedia.org/wiki/Wordle                                                                                                     | fetched 17 Oct 2026             | Share loop growth                                                                                                                                                       |
| https://en.wikipedia.org/wiki/Ludo_King                                                                                                  | fetched 17 Oct 2026             | Friends and family rooms                                                                                                                                                |
| https://en.wikipedia.org/wiki/Clash_Royale                                                                                               | fetched 17 Oct 2026             | Chest timers removed April 2025                                                                                                                                         |
| https://www.gameanalytics.com/reports/2025-mobile-gaming-benchmarks                                                                      | updated 24 Aug 2026             | Mobile D1 and D7 medians                                                                                                                                                |
| https://blog.duolingo.com/how-duolingo-streak-builds-habit/                                                                              | 31 Jan 2022                     | Early streak days, +1.7% D7                                                                                                                                             |
| https://blog.duolingo.com/friend-streak/                                                                                                 | 5 Aug 2024                      | Friend streak +22% (correlation)                                                                                                                                        |
| https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth                                                                    | 2023                            | Protect the channel, Groupon                                                                                                                                            |
| https://research.duolingo.com/papers/yancey.kdd20.pdf                                                                                    | KDD 2020                        | Template novelty decay                                                                                                                                                  |
| https://www.chess.com/blog/CHESScom/chess-is-booming-and-our-servers-are-struggling                                                      | 23 Jan 2023                     | 1M daily puzzle solvers                                                                                                                                                 |
| https://web.dev/articles/push-notifications-permissions-ux                                                                               | 26 Mar 2025                     | Two-step permission                                                                                                                                                     |
| https://www.nngroup.com/articles/push-notification/                                                                                      | 18 Nov 2018                     | Ask after value, conservative defaults                                                                                                                                  |
| https://developer.chrome.com/blog/permissions-chip                                                                                       | fetched 17 Oct 2026             | 6.69% Allow, Windows desktop                                                                                                                                            |
| https://onesignal.com/mobile-app-benchmarks-2024                                                                                         | 2024                            | Native app opt-in for games                                                                                                                                             |
| https://resend.com/pricing                                                                                                               | fetched 17 Oct 2026             | 3,000 a month, 100 a day free, Pro US$20                                                                                                                                |
| https://www.mailjet.com/pricing/                                                                                                         | fetched 17 Oct 2026             | 6,000 a month, 200 a day free                                                                                                                                           |
| https://aws.amazon.com/ses/pricing/                                                                                                      | fetched 17 Oct 2026             | US$0.10 per 1,000                                                                                                                                                       |
| https://support.google.com/a/answer/81126                                                                                                | fetched 17 Oct 2026             | Gmail sender rules                                                                                                                                                      |
| https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business                                                   | fetched 17 Oct 2026             | Opt-out in 10 days, postal address, US$53,088                                                                                                                           |
| https://developers.facebook.com/docs/whatsapp/pricing/                                                                                   | fetched 17 Oct 2026             | Per-message pricing since 1 Jul 2025                                                                                                                                    |
| https://www.interakt.shop/pricing/                                                                                                       | fetched 17 Oct 2026             | ₹0.95 to ₹0.97 marketing, ₹2,799 a month plan                                                                                                                           |
| https://www.msg91.com/pricing/sms                                                                                                        | fetched 17 Oct 2026             | ₹0.16 to ₹0.25 per SMS plus GST                                                                                                                                         |
| https://en.wikipedia.org/wiki/Digital_Personal_Data_Protection_Act,_2023                                                                 | fetched 17 Oct 2026             | Commencement dates, children's rules                                                                                                                                    |
| General knowledge (marked inline with confidence)                                                                                        |                                 | Domain prices, Bing powering DuckDuckGo, Render bandwidth, battery savers, GitHub 60 day rule, PO box cost, DPDP penalty cap, GDPR double opt-in, UptimeRobot free plan |
