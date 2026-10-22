# Deployment

## Production

|          |                                                                                            |
| -------- | ------------------------------------------------------------------------------------------ |
| Host     | Render web service **NoCapGaming** (free plan, Oregon) — https://nocapgaming.onrender.com  |
| Source   | `pragunb02/MultiPlayerRPS`, branch **`main`**                                              |
| Trigger  | **Auto-deploy of `main` after CI checks pass**: merging a PR _is_ a production deploy      |
| Database | MongoDB Atlas free cluster (`cluster0`)                                                    |
| Runs     | The new server (`apps/server`), serving the built web app (`apps/web/dist`) — since CC-029 |

### Render settings (dashboard → Settings)

These settings, and every env var that is not a secret, are also written in [`render.yaml`](../render.yaml). Once the
owner links it as a Blueprint, the file is what Render applies. Until then the dashboard is. See
[Render Blueprint](#render-blueprint-cc-294).

| Setting           | Value                                                                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build Command     | `npm ci --include=dev && npm run build:web` — exact lockfile install, then the web build (Vite is a dev dependency, so `--include=dev` even with `NODE_ENV=production`)                                                                                          |
| Start Command     | `npm start` — runs `apps/server/src/index.js`                                                                                                                                                                                                                    |
| Health Check Path | `/health` — 200 only when the database is connected; a failing new deploy is never promoted                                                                                                                                                                      |
| Auto-Deploy       | **After CI Checks Pass**: Render deploys a commit on `main` only when every GitHub check on it passed (success, neutral or skipped). A failed check on a merge commit means that commit is not deployed: fix `main`, and the next green commit deploys           |
| Node version      | from `.nvmrc`                                                                                                                                                                                                                                                    |
| Listen address    | `HOST=0.0.0.0` (in `render.yaml`). Render requires every web service to listen on 0.0.0.0 and the port in `PORT`; the server's own default is 127.0.0.1 (CC-287), which Render's proxy cannot reach, so without this setting every deploy fails its health check |

### Environment variables (dashboard → Environment)

Once the Blueprint is linked, only the secrets (`MONGO_URI`, `SESSION_SECRET`, `ADMIN_ACCOUNT_IDS`, and for operations telemetry
`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`) are set in the dashboard. Every other value below lives in `render.yaml` and changes by pull request.

| Variable                      | Required          | Notes                                                                                                                                                                                                                                                                       |
| ----------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGO_URI`                   | yes               | Atlas connection string, same database as the legacy app (legacy players log in from its `users`, CC-078). `MONGO_URI_PRODUCTION` is not read by the new server                                                                                                             |
| `SESSION_SECRET`              | yes               | at least 32 characters (`openssl rand -hex 32`); changing it logs everyone out                                                                                                                                                                                              |
| `NODE_ENV`                    | yes               | `production` (secure cookies, proxy trust, strict config)                                                                                                                                                                                                                   |
| `ALLOWED_ORIGINS`             | yes               | `https://nocapgaming.onrender.com` — origins allowed to call the API and open sockets (CSRF defence, ADR-010). The **first** one is the site's public address in link previews, canonical URLs, `robots.txt` and `sitemap.xml` (CC-047)                                     |
| `PORT`                        | set by Render     |                                                                                                                                                                                                                                                                             |
| `HOST`                        | yes               | `0.0.0.0` on Render (see Render settings). Default `127.0.0.1`: this machine only, so local runs are never offered to the network. An IP address or a hostname; anything else stops the boot. The startup log `server listening` shows the bound `host` and `port` (CC-287) |
| `WEB_DIST_DIR`                | yes               | `apps/web/dist` (relative to the repo root); the server refuses to boot without the build                                                                                                                                                                                   |
| `LOG_LEVEL`                   | no                | default `info`                                                                                                                                                                                                                                                              |
| `TRUST_PROXY_HOPS`            | no                | default `1` in production, `0` elsewhere. How many proxies in front of the server add to `X-Forwarded-For`; rate limits key on the address that many entries in from the right. See [Client addresses and rate limits](#client-addresses-and-rate-limits)                   |
| `ADMIN_ACCOUNT_IDS`           | no                | default empty: nobody can open the owner console. Comma separated account ids such as `user_65f0c2a1b2c3d4e5f6a7b8c9`. A guest id or a typo stops the boot. See [Owner console](#owner-console-cc-233)                                                                      |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no                | default unset: operations telemetry is off and no OpenTelemetry code is loaded. The `https://otlp-gateway-…/otlp` address of the Grafana Cloud stack. Must be `https://` in production. See [Operations telemetry](#operations-telemetry-cc-286-adr-055)                    |
| `OTEL_EXPORTER_OTLP_HEADERS`  | with the endpoint | `Authorization=Basic%20…` with the write-only token. **A secret.** Set together with the endpoint or the boot stops (the error names the variable, never its value)                                                                                                         |
| `OTEL_SDK_DISABLED`           | no                | `true` turns telemetry off and keeps the two variables in place                                                                                                                                                                                                             |
| `OTEL_LOGS_EXPORTER`          | no                | `none` sends metrics only. Default `otlp`                                                                                                                                                                                                                                   |
| `OTEL_METRIC_EXPORT_INTERVAL` | no                | milliseconds between exports, 1000 to 600000, default 60000                                                                                                                                                                                                                 |

Secrets live only in Render and local `.env` files — never in the repo (it is public), chat, or PR text.

### Render Blueprint (CC-294)

[`render.yaml`](../render.yaml) holds the service settings above and every env var the server reads (ADR-063).
Plain settings have their value in the file: `NODE_ENV`, `HOST`, `LOG_LEVEL`, `ALLOWED_ORIGINS`, `WEB_DIST_DIR`,
`TRUST_PROXY_HOPS`, and operations telemetry's `OTEL_SDK_DISABLED`, `OTEL_LOGS_EXPORTER` and
`OTEL_METRIC_EXPORT_INTERVAL` (CC-286). Secrets are `sync: false` with no value: `MONGO_URI`, `SESSION_SECRET`,
`ADMIN_ACCOUNT_IDS`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`. `PORT` and `RENDER_GIT_COMMIT` are
not in the file because Render sets them, at build and at run time. `RENDER_GIT_COMMIT` is the telemetry service
version and the `commit` on `/health`, and the build turns it into `/health`'s `version` (CC-303). `scripts/renderBlueprint.test.mjs` fails if a variable the config
reads is missing from the file, or if a secret has a value. A CI job on pull requests checks the file against
Render's published schema (`https://render.com/schema/render.yaml.json`).

**The file does nothing by itself.** Render reads it only for a Blueprint, which the owner creates in the dashboard
(New → Blueprint). Merging it changes nothing on Render.

#### What linking does to the live service (Render's docs, read 2026-10-20)

| Thing                                 | What happens                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Which service                         | Render matches an existing service **by name**: "If you add the name of an existing service to your Blueprint file, Render attempts to apply the Blueprint's configuration to that existing service" (render.com/docs/blueprint-spec). `type` and `region` can never change after creation                                     |
| Duplicate service                     | If Render does not match it, it plans a **new** service, and when names clash it "appends a suffix to the name of each new resource" (render.com/docs/infrastructure-as-code, Replicating a Blueprint). The review screen shows this before anything happens                                                                   |
| Plain values in the file              | Written to the service. A different dashboard value is overwritten                                                                                                                                                                                                                                                             |
| `sync: false` secrets                 | Kept. "When you update an existing Blueprint, Render ignores any environment variables with `sync: false`", and "The resource retains any existing environment variable values that aren't overwritten by the Blueprint" (render.com/docs/blueprint-spec, render.com/docs/infrastructure-as-code)                              |
| Env vars not in the file              | Kept: "Render preserves existing environment variables, even if you omit them from the Blueprint file" (render.com/docs/blueprint-spec). For example a `NODE_VERSION` set in the dashboard stays                                                                                                                               |
| Fields reset when the file omits them | Build filters ("Render replaces those settings with empty lists"), pull request previews (off), root directory (repo root), shutdown delay (30 s). Plan, instance count, auto-deploy, IP allow list and the onrender.com subdomain are kept when omitted                                                                       |
| Deleting                              | Never. "Changes to a Blueprint never cause a resource to be deleted" (render.com/docs/infrastructure-as-code). But a Blueprint-managed service deleted by hand is recreated on the next sync                                                                                                                                   |
| After linking                         | Every push to `main` that changes `render.yaml` syncs it (Auto Sync, the default). A dashboard edit to a field in the file is overwritten on the next sync, so change those fields by pull request. A **new** secret is added in the dashboard by hand: Render reads `sync: false` keys only when a Blueprint is first created |

One thing Render's docs do not spell out: what the first creation screen does when a `sync: false` key already has
a value on the service it adopts. The docs say that screen prompts "for each environment variable with
`sync: false`", and that a file made by Render's own Generate Blueprint (all `sync: false`) needs values only for
**new** services. So expect no prompt, and if one appears, follow step 7 below.

#### Owner steps

Do these on a laptop, in the dashboard only. Nothing is applied before step 8.

**Before linking (changes nothing):**

1. Wait until the CC-294 pull request is merged, so `render.yaml` is on `main`.
2. Open NoCapGaming → **Settings** and check each against `render.yaml`. The name is exactly `NoCapGaming`, the
   region Oregon, the instance type Free, the branch `main`, the build and start commands as above, the health check
   path `/health`, and Auto-Deploy "After CI Checks Pass". These must be empty or off, because linking resets them:
   **Root Directory**, **Build Filters** (included and ignored paths), **Pull Request Previews**, and a custom
   shutdown delay. If one is set and should stay, stop and ask for it to be added to `render.yaml` first.
3. Open **Environment**. Every secret must already be there: `MONGO_URI`, `SESSION_SECRET`, and `ADMIN_ACCOUNT_IDS`
   if the owner console is on. Compare the six plain values with the file: `NODE_ENV=production`, `HOST=0.0.0.0`,
   `LOG_LEVEL` (missing means `info`), `ALLOWED_ORIGINS=https://nocapgaming.onrender.com`,
   `WEB_DIST_DIR=apps/web/dist`, `TRUST_PROXY_HOPS` (missing means `1`). If the dashboard has a different value
   that is right (for example a measured `TRUST_PROXY_HOPS`), stop and change `render.yaml` by pull request first.
4. Optional second check: on the dashboard's service list, select NoCapGaming and click **Generate Blueprint**. It
   only shows a file (with no env var values) and changes nothing. Compare it with `render.yaml`. Differences should
   be the env var values only.
5. Open **Blueprints** and make sure no Blueprint already manages NoCapGaming (Render: "Do not add a resource to
   more than one Blueprint").

**Linking (the preview is the dry run):**

6. **New → Blueprint**, connect `pragunb02/MultiPlayerRPS`, name it (for example `ClassiCade production`), branch
   `main`, Blueprint Path `render.yaml`. Render then shows "the list of the changes that Render will apply". This
   screen is the dry run: nothing has changed yet. Go on only if it shows **NoCapGaming as an existing service** and
   nothing else. **Leave the page without applying** if it shows a new web service, a name with a suffix such as
   `NoCapGaming-xxxx`, a notice that the Blueprint "matches existing resources", a region or plan change, or any
   change step 2 or 3 did not predict.
7. If the screen asks for a value for `MONGO_URI`, `SESSION_SECRET` or `ADMIN_ACCOUNT_IDS`: **leave the page without
   applying**. Nothing has changed. Do not paste a secret there: a mistyped `SESSION_SECRET` logs every player out.
   Ask for a follow-up pull request that leaves the secrets out of the file (Render keeps env vars a Blueprint does
   not name) and start again at step 6. One exception: if `ADMIN_ACCOUNT_IDS` is not set on the service yet, it is
   fine to type your own account id or leave it empty (empty means nobody opens the console).
8. Click **Deploy Blueprint**. Render applies the file and redeploys NoCapGaming.

**After linking:**

9. Watch NoCapGaming → **Events** until the deploy is **Live**, then
   `curl https://nocapgaming.onrender.com/health` must answer `"status":"ok"` and `"database":"up"`, with the
   deployed `commit` and `version` (CC-303).
10. Check **Environment** again: the same keys as in step 3, and `MONGO_URI` and `SESSION_SECRET` still have their
    (hidden) values. Check **Settings**: Auto-Deploy still "After CI Checks Pass". The service list must show one
    NoCapGaming, now with the Blueprint icon, and no new service.
11. Leave the Blueprint's Auto Sync on "Yes": every change to `render.yaml` reaches `main` only through a reviewed
    pull request.

**If something went wrong:**

1. A deploy fails: Render keeps the last good deploy live (health check). Find the setting that changed in the
   Blueprint's sync history, fix `render.yaml` by pull request, or Rollback (below).
2. A secret was blanked or changed: set it again in **Environment** with its old value (`SESSION_SECRET` must be the
   old one, or every player is logged out) and redeploy.
3. A second service was created: **Suspend** it at once, before it gets secrets, so two servers never run on the
   production database. Then disconnect the Blueprint (Render keeps every resource), and only then delete the
   suspended copy. Deleting it while the Blueprint is linked makes Render recreate it on the next sync.

### Listen address (CC-287)

The server listens on `HOST`, default `127.0.0.1`, so `npm start` or `npm run dev:server` on a laptop is reachable
from that laptop only. Render needs `HOST=0.0.0.0` ("Every Render web service must bind to a port on host 0.0.0.0",
render.com/docs/web-services). The Docker image sets `HOST=0.0.0.0` inside the container, and `docker-compose.yml`
publishes its port on `127.0.0.1` only. Rollout order for the change that added it (done 2026-10-20, before the
Blueprint: `HOST` is now in `render.yaml`, so once the Blueprint is linked it changes by pull request only):

1. Render → Environment: add `HOST` = `0.0.0.0` and save. The running server ignores it (it does not read `HOST`), so
   the redeploy this starts changes nothing.
2. Merge the PR. The new server reads `HOST` and logs `server listening` with `"host":"0.0.0.0"`.
3. Check `/health`. If the deploy fails its health check, `HOST` is missing or wrong: Render keeps the last good
   deploy live; fix `HOST` and redeploy.

### Owner console (CC-233)

`/admin` shows totals from the data the site already stores (matches, guest transfers, accounts, achievements,
quests, leaderboards). For anyone whose account id is not in `ADMIN_ACCOUNT_IDS`, every `/admin` page and
`/api/admin/*` answer is the ordinary 404, so the console's existence is not revealed.

To turn it on for yourself:

1. Log in to the site with your own account.
2. Open `https://<site>/api/session` in the same browser. Copy `identity.id` (it starts with `user_`).
3. In Render → Environment, set `ADMIN_ACCOUNT_IDS` to that id (several ids: comma separated) and save. Render
   redeploys. This one stays in the dashboard after the Blueprint is linked: `render.yaml` lists it as
   `sync: false`, so Render never changes its value.
4. Reload the site: a **Console** link appears in the header for you only.

Removing an id and redeploying takes access away at once (it is checked on every request). Reports are cached for 5
minutes per range; a full report on 50,000 matches takes about half a second to work out (CC-233 ticket). The deploy
that ships it builds four new indexes at boot (`matches.endedAt`, `player_transfers.createdAt`, `accounts.createdAt`,
`player_achievements.unlockedAt`); on today's data that takes well under a second.

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

A signed-in session also ends **90 days after signing in** however often it is used, and whenever the account's
`sessionVersion` (in `accounts`) moves past the one the session was made at: changing the password and "sign out
other devices" on the profile do that (CC-116). Accounts and sessions from before CC-116 count as version 0, and
their 90 days start the first time the server sees them after the deploy, so nobody is logged out by it. Guest
sessions have no 90 day end.

## Rooms

Stored in MongoDB (`rooms`, and `closed_rooms` for the reason a room closed), so a deploy, a crash or the free plan's
sleep never loses a game (CC-101). Players' browsers reconnect and rejoin by themselves after a restart. The new
process marks every seat as away until its player is back, and applies chess flags that fell while no server ran.
How long rooms live is in `apps/server/src/domain/rooms/roomLifetimes.js` (rematch window 30 minutes, an away game
2 hours, closed room records 1 day). There are no settings for it in production.

How much one player and the whole server may use is in `apps/server/src/domain/rooms/roomLimits.js` (CC-107): 3
waiting rooms per player, 30 open rooms per network address, 2000 open rooms in all (past that, creating a room answers "The server is busy, try again
in a minute"), 5 realtime connections per browser session, 30 per address (found through `TRUST_PROXY_HOPS` like
the HTTP limits), and one event budget per player for all their tabs. Every minute the server logs `room gauge` with
the open rooms per status, the connections and the connected players. Watch it to see how close production is to
the limits.

A game starts only when every seat is taken and every seated player is connected (CC-112). A friend who opens an
invite while the host is away waits in the room, and the game starts when the host is back. Leaving the room page
for another page of the site leaves a waiting room.

## Finished games (the match pipeline)

Every finished game goes into `pending_matches` in MongoDB first (CC-111, ADR-047). From there the server records
the match, judges it for fair play, and applies progression, gamification and leaderboards, each a named step. A
step that fails is retried after 2 s, 4 s, 8 s and so on, at most 5 minutes apart, 10 attempts in all. A restart
resumes at the first step not done, and every step counts a game once however often it runs. Done records are
deleted by MongoDB after 2 days. Failed records stay.

What to watch in the logs:

1. `match pipeline failed` at error level, with `alert: true`, the `matchId`, the `step` and the error. A game gave
   up after its last attempt. **This is the line to alert on** (CC-049). Look at the error, fix the cause, then set
   the record's `status` back to `pending` and `attempts` to `0` in Atlas. The server picks it up within 5 seconds.
2. `match pipeline step failed, will retry` at warn level, with the next attempt time. A few of these during an
   Atlas blip are expected.
3. `finished games added to the match pipeline late` at warn level. A game finished but the pipeline never got it
   (a crash or a blip right after the game ended). It was added from its finished room and runs now.

A finished room adds its game to `pending_matches` before it changes or closes. While the database is down, a
rematch request or leaving a finished room fails and the player can try again. The game is never dropped with
the room.

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
3. Change `TRUST_PROXY_HOPS` to that number by pull request, never in the dashboard: the value in `render.yaml` and
   the one in `PLAIN` in `scripts/renderBlueprint.test.mjs`. Never set it above the measured count. Once the
   Blueprint is linked, a dashboard edit is quietly put back to the file's value on the next sync. Until it is linked,
   set the same number in Render → Environment as well, after the pull request merges. At startup the server logs
   `client addresses read through trusted proxies` with the `trustProxyHops` in effect.

The app-wide `/api` budget (CC-110) is 300 requests a minute, counted per session when the player has one (guest or
signed in) and per address otherwise. The stricter route limits still apply on top of it. `/health`, `/api/health`,
the web app and the realtime connection are not limited by it. A 429 answer has the standard error body
(`RATE_LIMITED`), a `Retry-After` header, and `RateLimit-Policy` / `RateLimit` headers. The end-to-end server raises
all budgets, because every test player connects from 127.0.0.1 (`e2e/app.mjs`).

## Repository protection (CC-109)

`main` accepts changes only through pull requests whose three CI checks pass (lint/format/audit/unit + integration,
browser tests, Docker); force pushes and deletion are blocked (admins can override in an emergency). Secret scanning
with push protection blocks pushes that contain credentials. Dependabot alerts and security updates, and CodeQL code
scanning, are on.

## Merge queue (CC-298, ADR-074)

> **Not available on this repository (2026-10-20).** GitHub rejects the `merge_queue` rule ("Invalid rule
> 'merge_queue'") because merge queues exist only for organization repositories, and `pragunb02/MultiPlayerRPS`
> belongs to a personal account. The owner applied the same JSON without that rule and with
> `strict_required_status_checks_policy: true` instead (ruleset "main: required checks, branch up to date", id
> 25472873): the seven required checks must pass on a branch that is up to date with `main`. The coordinator merges
> with `gh pr update-branch <n>` and then `gh pr merge <n> --merge --auto`. The `merge_group` triggers in ci.yml stay,
> harmless, for a move to an organization later. The steps below describe the queue as designed.

Two pull requests that are each green can still break `main` together (CC-247, CC-257). The merge queue tests each
pull request on top of the newest `main` and of the pull requests ahead of it, on a temporary branch
`gh-readonly-queue/main/...`, and merges only when every required check passed there. ci.yml starts on
`merge_group` for this, and its header has a table of which job runs on which event
(`scripts/workflows.test.mjs` pins it).

**The trade-off, the owner's choice.** A merge no longer lands when the button is pressed. It waits for CI to run
again in the queue, about 10 minutes, and longer when runners are busy. In return `main` only ever gets commits
that passed on exactly the code that lands. The push to `main` then runs CI once more on that same commit, which
Render waits for (Auto-Deploy, After CI Checks Pass).

### Owner steps (once)

The repository today has classic branch protection on `main` with no required checks (relaxed for the feature
phase, CLAUDE.md workflow rule 7) and no rulesets. Leave the classic rule as it is: it still blocks force pushes and
deletion. The ruleset below adds the required checks and the queue.

**1. Allow auto-merge and merge commits** (Settings, General, Pull Requests: "Allow merge commits" and "Allow
auto-merge" on). Or:

```bash
gh api -X PATCH repos/pragunb02/MultiPlayerRPS -F allow_auto_merge=true -F allow_merge_commit=true
```

**2. Create the ruleset** (Settings, Rules, Rulesets, New branch ruleset). Name `main: required checks and merge
queue`, Enforcement **Active**, no bypass list, target **Default branch**. Turn on:

1. **Restrict deletions** and **Block force pushes**.
2. **Require status checks to pass**, with "Require branches to be up to date before merging" **off** (the queue
   tests on the newest `main` itself, so this setting would only add rebases). Add these seven checks, source
   GitHub Actions, typed exactly:
   1. `Lint, format, audit, unit + integration (coverage gates)`
   2. `Docker image builds and serves (docker compose)`
   3. `Browser persona tests (desktop + mobile)`
   4. `Browser persona tests (firefox desktop)`
   5. `Backup round trip (mongodump, age, mongorestore)`
   6. `Workflow files (actionlint)`
   7. `Changelog fragments`
3. **Require merge queue**, with the values for a solo repository on GitHub's free runners (20 jobs at once, and one
   CI run takes about 15 of them):

   | Setting                              | Value          | Why                                                                                                                       |
   | ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
   | Merge method                         | **Merge**      | Keeps the `Merge pull request #N` commits the changelog collector reads the PR number from (CC-299)                       |
   | Build concurrency                    | **2**          | One group tests while the next waits, more would only queue for runners. At most 5 builders open PRs (rule 9)             |
   | Minimum group size                   | **1**          | A single PR never waits for company                                                                                       |
   | Maximum group size                   | **5**          | Up to the five builders' PRs can land together when all pass                                                              |
   | Wait time to meet minimum group size | **5 minutes**  | Only matters above a minimum of 1                                                                                         |
   | Status check timeout                 | **30 minutes** | CI takes about 10, its longest job may run 15, plus time waiting for runners. A stuck run leaves the queue, not blocks it |
   | Only merge non-failing pull requests | **On**         | Every PR passes on its own, never only because a later one in its group did                                               |

Or with the API, the same ruleset in one call (15368 is GitHub Actions' app id, so no other app can report these
names):

```bash
cat > /tmp/main-ruleset.json <<'JSON'
{
  "name": "main: required checks and merge queue",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "Lint, format, audit, unit + integration (coverage gates)", "integration_id": 15368 },
          { "context": "Docker image builds and serves (docker compose)", "integration_id": 15368 },
          { "context": "Browser persona tests (desktop + mobile)", "integration_id": 15368 },
          { "context": "Browser persona tests (firefox desktop)", "integration_id": 15368 },
          { "context": "Backup round trip (mongodump, age, mongorestore)", "integration_id": 15368 },
          { "context": "Workflow files (actionlint)", "integration_id": 15368 },
          { "context": "Changelog fragments", "integration_id": 15368 }
        ]
      }
    },
    {
      "type": "merge_queue",
      "parameters": {
        "merge_method": "MERGE",
        "max_entries_to_build": 2,
        "min_entries_to_merge": 1,
        "max_entries_to_merge": 5,
        "min_entries_to_merge_wait_minutes": 5,
        "check_response_timeout_minutes": 30,
        "grouping_strategy": "ALLGREEN"
      }
    }
  ]
}
JSON
gh api -X POST repos/pragunb02/MultiPlayerRPS/rulesets --input /tmp/main-ruleset.json
gh api repos/pragunb02/MultiPlayerRPS/rules/branches/main --jq '.[].type'   # deletion, non_fast_forward, required_status_checks, merge_queue
```

**3. CodeQL.** It runs from GitHub's default setup, not from a workflow in this repository, so ci.yml cannot add
`merge_group` to it, and its checks (`Analyze (actions)`, `Analyze (javascript-typescript)`) are **not** in the
list above: a required check that never reports on the queue's branch holds every PR until the timeout. Require it
instead with the ruleset rule **Require code scanning results** (tool CodeQL, alerts Errors, security alerts High
or higher), which reads the pull request's own results. Check this on the first PR through the queue. If the queue
waits on code scanning, turn that rule off and keep CodeQL as a review item until a CodeQL workflow with
`merge_group` (advanced setup) replaces the default setup, as its own ticket.

**4. Check it once** with a docs-only PR: `gh pr merge <n> --merge --auto` puts it in the queue (the PR page says
"Queued to merge"), a CI run appears for `merge_group` on a `gh-readonly-queue/main/...` branch, and the PR merges
about 10 minutes later. Then `git log -1 --format=%s origin/main` must start with `Merge pull request #<n>`. If it
does not, tell the coordinator: the collector then needs `pr:` in each fragment.

**To undo it** (an emergency merge): set the ruleset's Enforcement to Disabled (Settings, Rules, Rulesets), or
`gh api -X PUT repos/pragunb02/MultiPlayerRPS/rulesets/<id> -f enforcement=disabled` (the id is in
`gh api repos/pragunb02/MultiPlayerRPS/rulesets`). Turn it back on afterwards.

### How the coordinator merges from now on

```bash
gh pr merge <number> --merge --auto
```

This enqueues the PR once its own required checks have passed (or turns on auto-merge until they do). Nobody
merges by hand, rebases a PR onto `main` to make it mergeable, or presses "Update branch": the queue tests on the
newest `main` itself. A PR the queue removes (a failed check in the group, or the timeout) gets a comment from
GitHub naming the reason; fix it on the branch and run the command again. `gh pr merge <number> --disable-auto`
takes a PR out of the queue.

## The MongoDB image for Docker and CI (CC-288)

Production uses Atlas and is not affected. `docker-compose.yml` (local development and the required CI check
"Docker image builds and serves") runs MongoDB from an exact image: `mongo:8.2.12` with its multi-platform digest
`sha256:e0ce8c35124d4a9f9785532d1f268f39e9728ffa1cb38f46fa482436424c4bd3`. Never a floating tag such as `mongo:8`.

Why: on 2026-10-19 GitHub rolled out runner image `ubuntu-24.04` 20261018.339.1 with kernel `7.0.0-1017-azure`
(upstream 7.0.14). `mongo:8` is 8.3.13, and it and 8.0.34 stop at once on that kernel with
`"s":"F" ... "MongoDB cannot start: Linux kernel versions 6.19 and newer has a known incompatibility with this version
of MongoDB. See https://jira.mongodb.org/browse/SERVER-121912"`. Kernels 6.19 to 7.0.13 broke the rseq behaviour that
MongoDB 8's memory allocator needs, 7.0.14 restored it (SERVER-125742), but the check reads `uname -r`, which Ubuntu
keeps at `7.0.0`, so the fixed kernel is still refused (SERVER-136848, open). 8.2 has no such check: 8.2.12 started,
took 100,000 writes and stayed up for over a minute on the new kernel and on the old 6.17 one. The runner rollout was
gradual, so the job failed now and then at first and then most of the time. The image itself never changed.

To upgrade: try the new exact version on CI (the Docker job prints `docker compose logs mongo` when it fails), then
pin its digest from `docker buildx imagetools inspect mongo:<version>` (the `Digest:` line of the index, so it works
on Intel and Arm). Dependabot ignores `mongo` 8.3 and later until SERVER-136848 is fixed (`.github/dependabot.yml`).

**Existing local databases, once:** a Docker volume that `mongo:8` (8.3) created has feature compatibility version
8.3, and 8.2 cannot open it: mongod exits with `"Wrong mongod version" ... UPGRADE PROBLEM: Found an invalid
featureCompatibilityVersion document ... version: "8.3"` (checked locally). Run `docker compose down -v` once to delete
the old volume, and take a `mongodump` first with the old image if you need its data. CI starts from a fresh volume
every time. Production on Atlas is not affected. The same applies to any later move to an older version.

## Before merging any PR

CI (lint, format, audit, unit + integration tests with coverage gates, browser tests) must be green. Every PR fills in
the **Deployment impact** section of the PR template. If anything below changes, verify it first:

1. **Start/build behaviour** — `package.json` scripts, dependencies, Node version, entry file.
   Verify from a fresh clone: `NODE_ENV=production npm ci --include=dev && npm run build:web && npm start` (with the
   variables above, including `HOST=0.0.0.0`) logs "server listening" with that `host` and `/health` reports the
   database up.
2. **Environment variables** — every variable the config reads is listed in `render.yaml` (its test fails
   otherwise). A plain value is changed in `render.yaml` and in `PLAIN` in `scripts/renderBlueprint.test.mjs`, never
   in the dashboard: once the Blueprint is linked, the next sync puts a dashboard edit back. A new secret is added
   to `render.yaml` as `sync: false` and its value set by hand in Render → Environment _before_ merging (Render reads
   new `sync: false` keys only when a Blueprint is first created).
3. **Data** — schema or collection changes, migrations, anything that touches existing documents.
4. **Sessions/cookies** — changes can log users out.

## After merging

1. Watch the deploy in Render → Events/Logs until it is **Live**.
2. Check: `curl https://nocapgaming.onrender.com/health` →
   `{"status":"ok","database":"up","commit":"<sha>","version":"<YYYY.MM.DD+short sha>"}`; open one game page.
3. Confirm the merge is the deploy that answers (CC-303): `git fetch origin && git rev-parse origin/main` must print
   the same sha as `/health`'s `commit`. Until they match, Render is still building or kept the last good deploy
   (Events says which). `version` is the commit's UTC day and short sha, the same for every build of that commit.
   `"unknown"` in production means `RENDER_GIT_COMMIT` was missing or the build step `scripts/bin/build-info.mjs`
   could not ask git: the deploy is fine, only the label is missing.

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

- **Errors and slowness inside the app.** Covered by [Operations telemetry](#operations-telemetry-cc-286-adr-055) once
  the owner sets its two variables. Until then, no metrics.
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

## Operations telemetry (CC-286, ADR-055)

The server sends its own metrics and a short list of named log lines to a Grafana Cloud free stack over OTLP/HTTP
(protobuf). Nothing personal is sent (ADR-055 point 2, the allowlist in
`apps/server/src/dependency/telemetry/telemetrySchema.js`). **Merging changes nothing:** without
`OTEL_EXPORTER_OTLP_ENDPOINT` the server loads no OpenTelemetry code and opens no connection. Render's logs stay the
full record. The dashboard and the alert rules are files in [runbooks/grafana/](runbooks/grafana/).

### Owner steps (once)

Secrets go only into Grafana and Render. Never into the repository, a pull request, an issue or a chat.

1. **Create the stack in India.** Sign up at grafana.com (free, no card) and create a stack in the India region,
   AWS `ap-south-1`. If a free stack cannot be made there, use Singapore (AWS `ap-southeast-1`), and tell the
   coordinator: the privacy page says "India region" and must change in the same week. A stack's region cannot be
   changed later.
2. **Turn on two-factor sign-in** for the grafana.com account (your profile, Security). Invite nobody else
   (ADR-055, owner decision 5).
3. **Create a write-only token.** In the Cloud Portal, Access policies, create a policy for this stack with only the
   `metrics:write` and `logs:write` scopes (no read, no traces, no admin), then add one token to it. Copy the token
   once. The OpenTelemetry tile of the stack shows the OTLP endpoint and the instance id.
4. **Build the header on your own machine**, without the token landing in your shell history:
   `read -rs TOKEN; printf 'Authorization=Basic%%20%s\n' "$(printf '%s:%s' '<instance id>' "$TOKEN" | base64)"; unset TOKEN`
   (`base64 -w0` on Linux if the output wraps).
5. **Set the two variables in Render** (Environment, by hand: `render.yaml` lists them as `sync: false`, and Render
   reads such keys only when a Blueprint is first created): `OTEL_EXPORTER_OTLP_ENDPOINT` = the tile's
   `https://otlp-gateway-prod-ap-south-1.grafana.net/otlp` (your stack's address), and
   `OTEL_EXPORTER_OTLP_HEADERS` = the line from step 4. Save, which redeploys. Only after the code pull request has
   merged, or with it.
6. **Check it.** Render's log shows `telemetry on` after `server listening`, and no `telemetry export failed` in the
   next two minutes. In Grafana, Explore, the metrics data source answers `http_server_request_duration_milliseconds_count`.
7. **Import the dashboard.** Dashboards, New, Import, upload `docs/runbooks/grafana/classicade-operations.dashboard.json`,
   and pick the stack's metrics (`grafanacloud-…-prom`), logs (`grafanacloud-…-logs`) and `grafanacloud-usage`
   data sources.
8. **Alerts.** Alerting, Contact points: put your email on the default email contact point (the address stays in
   Grafana). Then create the five rules of `docs/runbooks/grafana/classicade-alerts.yaml` in Alerting, Alert rules,
   one per entry: query A is its `expr` on the named data source, the threshold is its `gt`, the pending period is
   its `for`, "no data" is OK. The three of ADR-055 point 6, plus the two free tier usage alerts at 80 %.
9. **After the first week**, open the stack's usage page: active series should be about 1 000 to 1 500 (CC-286,
   cardinality budget) against the free 10 000, and logs a few MB against 50 GB.

### Switching it off

At once: delete the value of `OTEL_EXPORTER_OTLP_ENDPOINT` and of `OTEL_EXPORTER_OTLP_HEADERS` in Render's dashboard
(it redeploys; the two go together or the boot stops). For good, keeping the secrets: a pull request that sets
`OTEL_SDK_DISABLED` to `"true"` in `render.yaml` (a dashboard edit of a Blueprint value is overwritten on the next
sync). Without a redeploy, delete the token in the Cloud Portal: exports fail, the server logs `telemetry export failed` at most once a minute, and the
game is unaffected. Export never runs inside a request, and a failed export never stops the server.

### If the free tier gets tight (ADR-055, amended 2026-10-20)

The usage alerts fire at 80 %. First find what grew on the dashboard (the series panel, `telemetry_logs_suppressed_total`)
and tune it, or set `OTEL_LOGS_EXPORTER=none`. Then the owner decides: Grafana Cloud pay as you go, or a self-hosted
Collector and Grafana. Either way only the two variables change, not the code.

## Usage counts (CC-174, CC-175, ADR-034)

Anonymous usage counts: the browser client (`telemetry_client`) and `POST /api/telemetry` (`telemetry_ingest`), both
CC-312 flags that merge **off**. No env var, no new dependency. The server makes the `telemetry_counts` collection and
its 30 day TTL index at boot (`syncIndexes`), so the merge itself changes nothing players see except the privacy page
section 4a and the footer's "no third-party trackers".

1. **The limits** (`apps/server/src/domain/telemetry/telemetryLimits.js`): 8 KB and 30 events a batch, 600 batches per 10 minutes per session (per network for a visitor), 2 000 events per network and 100 000 for the site per India day, counted per hour and kept 30 days. Only hourly counters are stored, never single events (owner review 2026-10-21). Every batch is answered `204`,
   whatever was kept. What was not stored is counted in Grafana as `telemetry.dropped` by `reason` (`opted_out`,
   `admin`, `invalid`, `rate_limited`, `cap`, `bot`, `flag_off`): the first five and `flag_off` count batches,
   `invalid` and `cap` count events.
2. **Owner steps, in order:**
   1. Wait until **27 October 2026** at the earliest: the privacy page promised a week's notice (owner, 2026-10-20).
   2. In `/admin/flags`, set `telemetry_ingest` **On**. Nothing is stored yet, because no browser sends.
   3. Set `telemetry_client` for **admins** (two days): your own browser sends batches (the network tab shows
      `POST /api/telemetry` with only catalogue fields), and the server drops them as `admin`, so still nothing is
      stored. Check `telemetry.dropped{reason="admin"}` rises in Grafana.
   4. **Before 10 %, measure the storage** on a copy (CC-175 Rabbit holes): insert 100 000 counter rows shaped like
      `apps/server/src/testing/telemetryCountDaoContract.js`'s `countRow` into a scratch database and read
      `db.telemetry_counts.stats().storageSize`. Thirty days of that must stay under the 150 MB guardrail. If it does
      not, lower `storedPerDay`, never raise the 30 days.
   5. Then 10 %, 50 % and 100 %, at least two days apart, comparing the guardrails of CC-174 (time to first move and
      page speed, flag on against off) at each step.
3. **Rollback:** set either flag Off. The next page load sends nothing, and the server drops every batch at once.
4. **Purge** the hourly counts, for a mistake found in a field: signed in as an admin, in the browser console on the site,
   `await fetch("/api/admin/telemetry?before=2026-11-01", { method: "DELETE" }).then((r) => r.json())` deletes
   everything that arrived before that India day and answers `{ deleted }`. Anyone else gets the console's 404.
5. **Flag removal:** both flags by 2027-01-31 (their own small PR, PROCESS.md).

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
