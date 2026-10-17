# Deployment

## Production

|          |                                                                                            |
| -------- | ------------------------------------------------------------------------------------------ |
| Host     | Render web service **NoCapGaming** (free plan, Oregon) — https://nocapgaming.onrender.com  |
| Source   | `pragunb02/MultiPlayerRPS`, branch **`main`**                                              |
| Trigger  | **Auto-deploy on every commit to `main`** — merging a PR _is_ a production deploy          |
| Database | MongoDB Atlas free cluster (`cluster0`)                                                    |
| Runs     | The new server (`apps/server`), serving the built web app (`apps/web/dist`) — since CC-029 |

### Render settings (dashboard → Settings)

| Setting           | Value                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build Command     | `npm ci --include=dev && npm run build:web` — exact lockfile install, then the web build (Vite is a dev dependency, so `--include=dev` even with `NODE_ENV=production`) |
| Start Command     | `npm start` — runs `apps/server/src/index.js`                                                                                                                           |
| Health Check Path | `/health` — 200 only when the database is connected; a failing new deploy is never promoted                                                                             |
| Node version      | from `.nvmrc`                                                                                                                                                           |

### Environment variables (dashboard → Environment)

| Variable           | Required      | Notes                                                                                                                                                                                                                                                     |
| ------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`        | yes           | Atlas connection string, same database as the legacy app (legacy players log in from its `users`, CC-078). `MONGO_URI_PRODUCTION` is not read by the new server                                                                                           |
| `SESSION_SECRET`   | yes           | at least 32 characters (`openssl rand -hex 32`); changing it logs everyone out                                                                                                                                                                            |
| `NODE_ENV`         | yes           | `production` (secure cookies, proxy trust, strict config)                                                                                                                                                                                                 |
| `ALLOWED_ORIGINS`  | yes           | `https://nocapgaming.onrender.com` — origins allowed to call the API and open sockets (CSRF defence, ADR-010). The **first** one is the site's public address in link previews, canonical URLs, `robots.txt` and `sitemap.xml` (CC-047)                   |
| `PORT`             | set by Render |                                                                                                                                                                                                                                                           |
| `WEB_DIST_DIR`     | yes           | `apps/web/dist` (relative to the repo root); the server refuses to boot without the build                                                                                                                                                                 |
| `LOG_LEVEL`        | no            | default `info`                                                                                                                                                                                                                                            |
| `TRUST_PROXY_HOPS` | no            | default `1` in production, `0` elsewhere. How many proxies in front of the server add to `X-Forwarded-For`; rate limits key on the address that many entries in from the right. See [Client addresses and rate limits](#client-addresses-and-rate-limits) |

Secrets live only in Render and local `.env` files — never in the repo (it is public), chat, or PR text.

## Cutover to the new stack (CC-029)

Done 2026-10-16. The legacy app tolerated every variable above, so the settings changed first and the code second:

1. In Render, set the environment variables above and change the Build Command. Render redeploys the legacy app with the
   new build step — that proves the web build works on Render before anything switches.
2. Merge the cutover PR (root `npm start` → new server). If the new server cannot boot or `/health` fails, Render keeps
   the legacy deploy live.
3. Check `/health`, play a game in two browsers, log in as a legacy player. Everyone is logged out once (new session
   store); legacy players log in with their old email and password and get a new account (CC-078).
4. Then delete the legacy code (separate PR).

What happened: the first new-server deploy refused to boot (`SESSION_SECRET` shorter than 32 characters); Render kept
the legacy deploy live. With a new secret the next deploy went live; `/health`, a two-browser chess game and the CSP
headers were verified in production.

Rehearsed from a fresh clone with `NODE_ENV=production`: build, boot, `/health`, deep links, cached assets, a chess game
between two browsers with no CSP errors, and a legacy login through the UI. Locally over plain HTTP, add
`X-Forwarded-Proto: https` to requests — the session cookie is `Secure` and only set behind an HTTPS proxy, as on Render.

## Sessions

Server-side in MongoDB (`player_sessions`), cookie `cc.sid` (HttpOnly, Secure, SameSite=Lax). **Rolling 30 days**
(CC-096): every visit re-issues the cookie and moves expiry to 30 days after it; the stored copy's expiry is rewritten
at most once an hour; MongoDB's TTL index deletes expired sessions. Changing `SESSION_SECRET` logs everyone out.

## Rooms

Stored in MongoDB (`rooms`, and `closed_rooms` for the reason a room closed), so a deploy, a crash or the free plan's
sleep never loses a game (CC-101). Players' browsers reconnect and rejoin by themselves after a restart. The new
process marks every seat as away until its player is back, and applies chess flags that fell while no server ran.
How long rooms live is in `apps/server/src/domain/rooms/roomLifetimes.js` (rematch window 30 minutes, an away game
2 hours, closed room records 1 day). There are no settings for it in production.

## Client addresses and rate limits

Every per-address rate limit (sign-up and login, guest creation, leaderboards, and the app-wide `/api` budget) keys on
`req.ip` (CC-106). Express finds it by counting `TRUST_PROXY_HOPS` proxies in from the right end of
`X-Forwarded-For`. Each proxy adds one address on the right, so entries further left were written by someone we do not
trust, and a forged entry on the left can never become the key.

1. Too low (for example `1` when there are two proxies): every player is counted as the proxy's address, so players
   share one small budget and get "too many attempts". This is the safe failure: nobody can bypass a limit.
2. Too high: `req.ip` becomes an entry the player wrote, so a script can pick a new key for every request and bypass
   every per-address limit. Never set it higher than the number of proxies.
3. Production needs at least `1`: HTTPS ends at Render's proxy, and the `Secure` session cookie is only set when the
   server trusts that proxy's `X-Forwarded-Proto`. Config refuses `0` in production.

Render does not document how many proxies sit in front of a web service (it uses Cloudflare internally for DDoS
protection, see render.com/docs/ddos-protection). The default `1` is the one value that can never be forged. To check
the real number without logging any address:

1. After a deploy, open the site in a browser and copy the `X-Request-Id` response header of one `/api` request
   (browser dev tools, Network tab).
2. Find that request id in the Render logs. The `request completed` line has `forwardedEntries`, the number of entries
   in `X-Forwarded-For` (only the count, never the addresses). A browser sends none, so this is the number of proxies.
3. Set `TRUST_PROXY_HOPS` to that number in Render (dashboard → Environment) and redeploy. At startup the server logs
   `client addresses read through trusted proxies` with the `trustProxyHops` in effect.

The app-wide `/api` budget (CC-110) is 300 requests a minute, counted per session when the player has one (guest or
signed in) and per address otherwise. The stricter route limits still apply on top of it. `/health`, `/api/health`,
the web app and the realtime connection are not limited by it. A 429 answer has the standard error body
(`RATE_LIMITED`), a `Retry-After` header, and `RateLimit-Policy` / `RateLimit` headers. The end-to-end server raises
all budgets, because every test player connects from 127.0.0.1 (`e2e/app.mjs`).

## Before merging any PR

CI (lint, format, audit, unit + integration tests with coverage gates, browser tests) must be green. Every PR fills in
the **Deployment impact** section of the PR template. If anything below changes, verify it first:

1. **Start/build behaviour** — `package.json` scripts, dependencies, Node version, entry file.
   Verify from a fresh clone: `NODE_ENV=production npm ci --include=dev && npm run build:web && npm start` (with the
   variables above) logs "server listening" and `/health` reports the database up.
2. **Environment variables** — new/renamed/removed variables must be set in Render _before_ merging.
3. **Data** — schema or collection changes, migrations, anything that touches existing documents.
4. **Sessions/cookies** — changes can log users out.

## After merging

1. Watch the deploy in Render → Events/Logs until it is **Live**.
2. Check: `curl https://nocapgaming.onrender.com/health` → `{"status":"ok","database":"up"}`; open one game page.

## Rollback

Render → Deploys → pick the last good deploy → **Rollback**. Then fix forward with a PR.
(While the health check is set, a broken deploy usually never goes live in the first place.)

## Backups (CC-108)

Every night at 03:17 UTC `.github/workflows/backup.yml` dumps the production database with a **read only** user,
encrypts the dump with the owner's age public key and uploads it to the owner's private S3 compatible bucket, which
keeps 30 days. Nothing from the dump appears in the (public) logs and it is never an Actions artifact. Until the
secrets are set every run skips with a notice. Setup, restore, verification and the rehearsal checklist:
[runbooks/backup-restore.md](runbooks/backup-restore.md).

## Uptime monitoring (CC-049, first part)

`.github/workflows/uptime.yml` checks production every 10 minutes from GitHub Actions. No secrets or accounts needed.

| Step            | What happens                                                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Probe           | `GET /health` must answer 200 with the database up, then `GET /` must answer 200 with HTML. Free plan cold starts are allowed for: retries with doubling waits (5, 10, 20, 40 s) for up to 90 s for `/health` and 30 s for the page |
| First failure   | A warning on the run, nothing else. One failed check can be a blip                                                                                                                                                                  |
| Second in a row | Opens an issue labelled **incident** with the time of the first failed check and every attempt's timing and result                                                                                                                  |
| Still down      | Each check rewrites that issue: failed checks in a row, how long it has been down, the latest timings                                                                                                                               |
| Back up         | The first passing check comments how long it was down and closes the issue                                                                                                                                                          |

The logic is in `scripts/uptime/` and tested in CI. A run remembers nothing itself: it learns whether the check before
failed from the previous run's "Site is down" step. Issues filed by hand with the label are left alone. If the
monitor itself breaks (for example the GitHub API fails), the run fails and GitHub emails the owner.

**Owner:** to hear about incidents, Watch the repository with at least **Issues** (Watch → Custom → Issues), or
GitHub's mobile app notifies you.

What it does **not** cover yet (the rest of CC-049):

- **Errors and slowness inside the app.** A page that loads but a game that fails, a socket error, a slow API: no
  error tracking or metrics yet.
- **Paging.** An issue and a GitHub notification is the only alert. Nobody is woken up.
- **Exact timing.** GitHub runs schedules on a best effort basis, often a few minutes late and sometimes skipped
  under load, so "every 10 minutes" is roughly every 10 to 20. An outage shorter than two checks may never open an
  incident.
- **GitHub itself.** If Actions is down, nothing is checked. Checks come only from GitHub's network.
- **Inactivity.** GitHub turns off scheduled workflows in a public repository after 60 days without a commit. Re-enable
  it under Actions if that happens.

Side effect: a request every 10 minutes keeps the free Render instance from going to sleep (it sleeps after 15 idle
minutes), so visitors no longer meet cold starts. That uses the free instance hours (750 a month per workspace,
enough for one service running all month). If a second free service is ever added, slow the schedule down.

## Known operational risks

- **Free Atlas clusters pause after long inactivity** → DNS stops resolving (`querySrv ENOTFOUND`). Resume it in Atlas.
  Enable Atlas alert emails.
- **Free Render instances sleep when idle** — first request after a while takes ~30–60 s. The uptime check (above)
  keeps it awake as a side effect.
- **No backups until the owner sets them up** — see [runbooks/backup-restore.md](runbooks/backup-restore.md).

## Incidents

- **2026-10-16 — deploys of `main` failing.** Render's dashboard start command was `nodemon index.js`; PR #1 removed
  nodemon. Separately the Atlas cluster was paused (DNS NXDOMAIN). The previous deploy stayed live, but new code could
  not ship. Fixed by setting Build `npm ci` / Start `npm start` and resuming the cluster. Follow-ups (CC-077): this
  document, `/health` endpoint + health check, PR template with deployment impact.
