# Business Requirements Document — ClassiCade

|              |                |
| ------------ | -------------- |
| Owner        | Pragun Bhutani |
| Status       | Draft v0.1     |
| Last updated | 2026-10-16     |

## 1. Vision & mission

**Vision:** The default place on the internet to play classic games with anyone.
**Mission:** _Play the classics with anyone, anywhere, in one click._

ClassiCade is a casual, social, skill-based gaming platform: instant multiplayer, zero install, playable on any device,
with fair competition and reasons to return daily.

## 2. Problem & opportunity

- Classic games online are fragmented: one site per game, ad-heavy, signup walls, poor mobile UX.
- Strong single-game players exist (Chess.com, Lichess), but nobody owns _"all the classics, social-first"_.
- Remote friends, families, classrooms and offices want a lightweight shared activity — a link that just works.

## 3. Target users

| Segment                     | Need                      | What wins them                          |
| --------------------------- | ------------------------- | --------------------------------------- |
| Casual players              | 5-minute fun, no friction | Guest play, quick match, bots           |
| Friends & families (remote) | Play together             | Invite link, rematch, chat/emotes       |
| Competitive players         | Progress, status          | Ratings, leaderboards, seasons, replays |
| Schools, colleges, offices  | Team activities           | Private tournaments, clubs, branding    |
| Creators/streamers          | Content                   | Spectate, stream mode, challenge links  |

## 4. Value proposition / differentiators

1. **Link → playing in < 10 seconds**, no signup required.
2. **Many classic games, one identity** — one profile, one level, ratings per game.
3. **Fair by design** — server-authoritative results, anti-cheat.
4. **AI opponents and coaching** — always someone to play; learn while playing.
5. **Social-first** — friends, clubs, rematches, shareable results.

## 5. Business objectives

| ID   | Objective                               | Target (12 months post-launch)                     |
| ---- | --------------------------------------- | -------------------------------------------------- |
| BO-1 | Launch a public, stable, secure product | Stage 1 live, 99.5% uptime                         |
| BO-2 | Build an engaged player base            | 10k WAU; D7 retention ≥ 20%                        |
| BO-3 | Organic growth through sharing          | Viral coefficient ≥ 0.3                            |
| BO-4 | Validate monetization                   | ≥ 2% free→paid; revenue covers infra costs         |
| BO-5 | Scalable game catalog                   | New game addable in ≤ 2 weeks via engine interface |

## 6. Business model

- **Free core forever** — playing is never paywalled.
- **ClassiCade Plus (subscription):** ad-free, unlimited analysis & replays, premium bots, exclusive themes, profile cosmetics.
- **Cosmetics store:** board skins, piece sets, emotes, avatar frames. _Cosmetic only — never pay-to-win._
- **Ads (free tier):** light, non-intrusive; optional rewarded ads between matches; never mid-game.
- **B2B:** private branded tournaments/events for companies, schools, colleges.
- **Later:** sponsored tournaments, creator partnerships.

## 7. Business capabilities required

| Area           | Capability                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Product        | Game catalog; modes (friend link, quick match, bot, private room, tournament); progression; social       |
| AI             | Tiered bots, post-game coach, smart matchmaking, anti-cheat & toxicity detection                         |
| Trust & safety | Server-authoritative play, reporting/blocking/mute, moderation, child safety                             |
| Compliance     | Privacy policy, ToS, cookie consent, data export & deletion (GDPR-style)                                 |
| Security       | Secure auth, MFA for admins, rate limiting, audit logs, vulnerability management                         |
| Platform       | Mobile-first PWA, horizontally scalable realtime backend, reconnect, CI/CD, observability                |
| Operations     | Admin console, feature flags, analytics & A/B testing, support/help center, content ops (seasons/events) |
| Growth & brand | Brand identity & design system, SEO landing pages, referrals, community (Discord), launch campaigns      |
| Finance        | Payments (subscriptions, store), invoicing for B2B, cost monitoring                                      |

## 8. Success metrics (KPIs)

- **North star:** Weekly active players with ≥ 3 completed matches.
- **Engagement:** D1 / D7 / D30 retention; matches per user per day; time-to-first-match (< 10 s).
- **Growth:** invites sent → accepted conversion; viral coefficient; organic/SEO traffic.
- **Monetization:** guest→registered conversion; free→paid conversion; ARPU; store revenue.
- **Quality:** match completion rate; matchmaking wait time; reconnect success; crash/error rate; p95 move latency < 150 ms.
- **Trust:** reports per 1k matches; cheating detections; time-to-action on reports.

## 9. Stages (business view)

| Stage            | Business outcome                                                                       |
| ---------------- | -------------------------------------------------------------------------------------- |
| 0 — Foundation   | Codebase is secure, structured, tested, deployable. No public launch yet.              |
| 1 — MVP launch   | Public launch: 3 polished games, invite links, guest play, bots, ratings, legal pages. |
| 2 — Retention    | Matchmaking, friends, achievements, seasons, replays, admin & analytics.               |
| 3 — Monetization | Plus subscription, cosmetics store, light ads.                                         |
| 4 — Scale        | More games, tournaments, clubs, B2B, native apps, AI coach.                            |

Detailed product scope: [PRD.md](PRD.md). Execution: [BACKLOG.md](BACKLOG.md).

## 10. Constraints & assumptions

- Solo founder/developer initially → favour managed services, simple ops, small surface area.
- Low budget → free/low tiers (managed Mongo/Postgres, container host, CDN) until traction.
- Web first (PWA); native apps only after Stage 2 metrics justify it.
- Users may be minors → child-safety defaults (no open chat for unverified/young users).

## 11. Risks

| Risk                              | Mitigation                                                      |
| --------------------------------- | --------------------------------------------------------------- |
| Cheating undermines ratings       | Server-authoritative engine; anti-cheat signals; report flow    |
| Toxicity/abuse                    | Emotes-first chat, filters, mute/block/report, moderation queue |
| Cold start (no one to match with) | Bots fill empty queues; invite-link focus; time-boxed events    |
| Legal/privacy exposure            | Privacy policy, ToS, consent, data deletion before launch       |
| Scope creep                       | Stage exit criteria; one new game at a time                     |
| Infra cost spikes                 | Cost alerts; stateless servers; Redis adapter only when needed  |

## 12. Out of scope (for now)

Real-money gaming/betting, crypto/NFTs, user-generated games, native apps before Stage 4.
