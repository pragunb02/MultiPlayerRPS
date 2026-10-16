# Deployment

## Production

|          |                                                                                           |
| -------- | ----------------------------------------------------------------------------------------- |
| Host     | Render web service **NoCapGaming** (free plan, Oregon) — https://nocapgaming.onrender.com |
| Source   | `pragunb02/MultiPlayerRPS`, branch **`main`**                                             |
| Trigger  | **Auto-deploy on every commit to `main`** — merging a PR _is_ a production deploy         |
| Database | MongoDB Atlas free cluster (`cluster0`)                                                   |
| Runs     | The legacy app (`index.js`) until the new stack replaces it (CC-028, CC-029)              |

### Render settings (dashboard → Settings)

| Setting           | Value                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Build Command     | `npm ci` — installs exactly what `package-lock.json` pins (never `yarn`, which ignores it)  |
| Start Command     | `npm start`                                                                                 |
| Health Check Path | `/health` — 200 only when the database is connected; a failing new deploy is never promoted |
| Node version      | from `.nvmrc`                                                                               |

### Environment variables (dashboard → Environment)

| Variable         | Required                | Notes                                                                                      |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `MONGO_URI`      | yes                     | Atlas connection string. `MONGO_URI_PRODUCTION` still accepted with a warning until CC-074 |
| `SESSION_SECRET` | yes                     | long random string (`openssl rand -hex 32`); changing it logs everyone out                 |
| `NODE_ENV`       | yes                     | `production` (secure cookies, proxy trust)                                                 |
| `PORT`           | set by Render           |                                                                                            |
| `WEB_DIST_DIR`   | new stack only (CC-029) | built web app served by the server, e.g. `apps/web/dist`                                   |

Secrets live only in Render and local `.env` files — never in the repo (it is public), chat, or PR text.

## Before merging any PR

Every PR fills in the **Deployment impact** section of the PR template. If anything below changes, verify it first:

1. **Start/build behaviour** — `package.json` scripts, dependencies, Node version, entry file.
   Verify from a fresh clone: `NODE_ENV=production npm ci && npm start` reaches "Listening on PORT".
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
