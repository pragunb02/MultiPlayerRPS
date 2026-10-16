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

| Variable          | Required      | Notes                                                                                                                                                           |
| ----------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`       | yes           | Atlas connection string, same database as the legacy app (legacy players log in from its `users`, CC-078). `MONGO_URI_PRODUCTION` is not read by the new server |
| `SESSION_SECRET`  | yes           | at least 32 characters (`openssl rand -hex 32`); changing it logs everyone out                                                                                  |
| `NODE_ENV`        | yes           | `production` (secure cookies, proxy trust, strict config)                                                                                                       |
| `ALLOWED_ORIGINS` | yes           | `https://nocapgaming.onrender.com` — origins allowed to call the API and open sockets (CSRF defence, ADR-010)                                                   |
| `PORT`            | set by Render |                                                                                                                                                                 |
| `WEB_DIST_DIR`    | yes           | `apps/web/dist` (relative to the repo root); the server refuses to boot without the build                                                                       |
| `LOG_LEVEL`       | no            | default `info`                                                                                                                                                  |

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

## Known operational risks

- **Free Atlas clusters pause after long inactivity** → DNS stops resolving (`querySrv ENOTFOUND`). Resume it in Atlas.
  Enable Atlas alert emails.
- **Free Render instances sleep when idle** — first request after a while takes ~30–60 s.

## Incidents

- **2026-10-16 — deploys of `main` failing.** Render's dashboard start command was `nodemon index.js`; PR #1 removed
  nodemon. Separately the Atlas cluster was paused (DNS NXDOMAIN). The previous deploy stayed live, but new code could
  not ship. Fixed by setting Build `npm ci` / Start `npm start` and resuming the cluster. Follow-ups (CC-077): this
  document, `/health` endpoint + health check, PR template with deployment impact.
