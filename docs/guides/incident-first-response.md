# Incident first response

What to do in the first minutes when something is broken, before you know why. It is written for
whoever is around, not only for the person who built the system. Each section follows the same
order: **symptoms**, **first 5 minutes**, **likely causes**, **fix or escalate**.

Measure before you theorise. On "wrong or stale art" reports, the first theory has been wrong far
more often than right. A header, a health endpoint or a log line settles most of these in a minute.

Related guides:

- [INFRA.md](../INFRA.md): services, URLs, env names. [§ Monitoring & error
  tracking](../INFRA.md#monitoring--error-tracking-2026-09-29) describes the signals used here.
- [release-and-rollback.md](release-and-rollback.md): moving online games between engine releases.
- [publish-and-deliver.md](publish-and-deliver.md): publishing a game and building deliveries.
- [backups.md](backups.md): restoring the database or R2.
- [rotate-a-secret.md](rotate-a-secret.md): when the incident exposed a credential.

## The signals

Some of these layers are **dormant until the owner finishes setting them up** (Sentry DSNs,
Better Stack monitors, the Railway healthcheck, the backup environment). The "Blocked" list in
[status/infra](../status/infra.md) says which. A signal that is not set up yet cannot warn you, so
do not read silence from it as good news.

| Signal | Where | What it tells you |
| --- | --- | --- |
| Launcher health | `https://app.invisiblewall.org/api/health` | 200 `{"ok":true,"db":"ok","migrations":{…,"schema":"current"}}`, or 503 with `db: down / unconfigured` or `schema: behind / unknown` |
| Launcher build | `https://app.invisiblewall.org/_app/version.json` | the build stamp in ms since epoch; decode it to see when the running launcher was built |
| Games host health | `https://games.invisiblewall.org/healthz` | `games` (the keys it serves), `runtimes` (the engine release each runtime serves), `pinned` (canary games), `lastHydrate` (did its last R2 read succeed). 503 `"ok":false` = it serves nothing |
| Tool health | `https://atlas-tool-production.up.railway.app/healthz`, `https://sheet-tool-production.up.railway.app/healthz` | liveness plus `commit`, the first 12 characters of the running commit. The only path that needs no launcher session |
| `X-Runtime-Release` | response header on files the games host serves from a runtime | which engine release answered, as `lines@<version>` |
| `X-IE-Runtime-Source` | response header on the game's `/api/editor/runtime?…` request (DevTools → Network) | `snapshot` = the published version; `live` = an authoring boot from a launcher link; `live-fallback` = a game published before snapshots existed |
| `ETag`, `Server-Timing` | the same request | `ETag` is the published version id. `Server-Timing` holds per-step times when a live assemble ran |
| Game console | the game tab's DevTools console | `window.__IE_RUNTIME_STALE__` (why the boot is not showing current data), a `[runtime] LAYOUT-ONLY BOOT` line, and the fetch retry lines. `?flowlog=1` traces the game flow |
| Sentry | projects `game-runtime`, `launcher`, `pipeline-tools` | game boot failures (`area: boot`), RGS failures (`area: rgs` with `action` and `status`), launcher server errors (`route`, `area: migrate`), tool errors (`service`) |
| Better Stack | the Uptime dashboard, and email | the four health endpoints above, from outside Spain |
| GitHub issues | the repo's Issues tab | **"Runtime release failed: lines"** and **"Nightly backup failed"** are opened automatically by their workflows. One issue collects every failure until it is closed |
| Deploy status | the GitHub commit status API ([INFRA](../INFRA.md#services-railway), "How to tell whether a push actually deployed") | per service, whether a commit deployed or was skipped |
| Railway | each service → Deployments → build and deploy logs | build failures, boot errors, the tool's `[gate]` line |
| RunPod | the Serverless endpoint → Logs → export | worker errors. See [§ 3](#3-generation-is-failing) for how to read the export |

### First, is it Spain?

Spanish ISPs block whole Cloudflare IP ranges during LaLiga matches, typically in the evening.
Anything on a blocked range disappears for Spanish users. This has already been mistaken twice for
an outage: once for R2, once for a partner RGS.

**The signature, all together:**

- **TCP timeouts**, not HTTP errors. `curl` hangs until its connect timeout; the browser says
  `TypeError: Failed to fetch`.
- **DNS resolves normally**, to Cloudflare addresses.
- `fetch(url, { mode: 'no-cors' })` from the console **fails too**. That rules out CORS.
- **Other sites work**, including other Cloudflare sites.

**What to do.** Probe the same URL from outside Spain: a Railway shell, a cloud VM, a VPN, or
Better Stack's non-Spanish region. If it answers there, it is the block, and it ends on its own.
**Anything that came back with a response body is not the block.** An error in a body came from
the server and means what it says.

Railway-hosted services are not affected server-side, so publishes and releases keep working.
What fails is tools on a Spanish connection talking to R2, and Spanish players talking to a
blocked partner host ([INFRA § R2](../INFRA.md#r2-cloudflare-object-storage)).

## 1. A game is blank, broken or stale

**Symptoms**

- The game stops on **"This game could not load"**, with a Reload button.
- The game shows the right layout but no art, the wrong config, or the engine's sample game.
- An edit or an engine fix "is not in the game".
- Every online game broke at the same time.

**First 5 minutes**

1. **One game or all?** Open two other published games (the launcher's Games section, or
   `https://games.invisiblewall.org/`).
   - All broken, right after something merged to `main`: go straight to "a bad engine release" in
     the table below.
   - One game only: continue here.
2. **Is the games host serving it?**
   - `curl -s https://games.invisiblewall.org/healthz`: the game's key must be in `games`. Note
     `runtimes.lines`, and whether the game is `pinned`.
   - `curl -sI https://games.invisiblewall.org/<key>/`: `X-Runtime-Release` is the engine release
     this game actually gets.
3. **What did the game's data request say?** Open the game with DevTools → Network, filter on
   `runtime`, and read `/api/editor/runtime?…`. The whole read is laid out in
   [publish-and-deliver § How to tell what players are getting](publish-and-deliver.md#how-to-tell-what-players-are-getting).
   - **200:** read `X-IE-Runtime-Source` and `ETag`. Compare them with the Game Maker card's line
     "Players get the version published … by …".
   - **401:** the link's `?k=` is wrong or out of date.
   - **502, refused or pending:** the launcher is down or restarting. Go to § 2.
4. **Read the console, but take the status from the Network tab.**
   - `signal timed out` means the server answered too slowly. `502` or `Failed to fetch` means the
     server is down. The two need opposite fixes.
   - `Failed to fetch` can hide a real status. The launcher adds CORS headers to its own error
     answers on these endpoints (`hooks.server.ts`). An answer that does not come from the
     launcher itself, such as one sent while its container restarts, can reach the console only as
     `Failed to fetch`.
   - `[runtime] LAYOUT-ONLY BOOT` means the data bundle failed and only the layout loaded. Every
     "not found in loadedAssets" line after it is a consequence of that, not a missing asset.
   - Type `window.__IE_RUNTIME_STALE__` to see the recorded reason.
5. **Check the automatic alerts.** Look for an open **"Runtime release failed: lines"** issue, and
   for Sentry `game-runtime` events with `area: boot`, filtered by the `game` or `project` tag.

**Likely causes**

| What you found | Cause | Fix |
| --- | --- | --- |
| `snapshot`, but the edit is missing | the edit was saved but never published, or someone made an older version live | Game Maker → **Publish**, or **Published versions → Make live** ([game-maker](../tools/game-maker.md#published-versions-and-rollback)) |
| `live-fallback` | the game was published before versioned snapshots; players get slow live data | **Republish** it |
| every online game broke right after an engine merge | a bad engine release, which goes live on merge | **Runtime rollback** workflow, action `rollback` with an empty version (the previous release); then revert the commit on `main`, or the next engine merge ships it again ([release-and-rollback § 4](release-and-rollback.md#4-roll-the-engine-back)) |
| "Runtime release failed: lines" issue is open | usually the release did not go out, and games are **still on the previous engine**, not broken. Which step failed decides what to do | [release-and-rollback § 3](release-and-rollback.md#3-when-a-release-fails); close the issue once a run is green |
| `X-Runtime-Release` is older than the release the pointer names | the games host has not re-read R2 yet, or your own browser holds the old page | load with `?cb=<anything>` first; then follow [release-and-rollback § The release is green in R2 but games serve the old engine](release-and-rollback.md#the-release-is-green-in-r2-but-games-serve-the-old-engine) |
| a publish, release or rollback never takes effect; `/healthz` shows `lastHydrate.succeeded: false` and the log says `[test-server] refresh failed:` | one unreadable object in **any** game's bundle, or R2 unreachable, aborts the whole re-read. `POST /refresh` answers 202 before the re-read runs, so the caller never sees the failure. The server keeps serving its previous state | find the failing key in the log; fix or remove that game's files in R2; refresh again |
| `/healthz` answers 503 `"ok":false`, `games` empty | the games host failed to read R2 at boot (a bad R2 key, R2 unreachable, or the unreadable-object case above). It retries in the background | Railway → Invisible-test-Server logs; check the R2 key; redeploy |
| 502 or refused on the data request, or "could not load" just after a push to `main` | the launcher is down, or mid-deploy (every push redeploys it). A player's game retries for up to 2 minutes before it gives up | reload once the deploy is up; if it persists, § 2 |
| launcher links (**Live ↗**, the Games cards) are slow, then show a layout-only boot | an authoring boot assembles everything live. A full project measured 83–97 s, which can outrun the client. Player boots read the published snapshot and answer quickly, so a slow **Live ↗** is not an outage | check with **Play ↗**, which is what players get. Report it to a developer (the Game Maker read-path item in [status/game-maker](../status/game-maker.md)) |
| a game serves old files after a republish | the Cloudflare edge cache. The per-game purge after a desktop publish covers only that game's own `test_server/<key>/` files, not the shared runtime, and it silently does nothing when `CF_API_TOKEN` is unset (Railway only) | /admin → **Purge edge cache (whole zone)**; safe, since game files are `no-store` or content-hashed |
| "Engine update available" badge on the card | this game was published before the current engine release | **Republish + Reconcile** on the card |

**Escalate** to the engine lead, with:

- the game key and URL, and the time in UTC;
- `X-Runtime-Release`, `X-IE-Runtime-Source` and `ETag`;
- the console lines;
- the Sentry issue link.

A desktop-built or partner-delivered game has its own bundle. For publish-side symptoms, see
[publish-and-deliver § If it goes wrong](publish-and-deliver.md#if-it-goes-wrong). For which
rollback to use, see
[release-and-rollback § Which rollback do I need?](release-and-rollback.md#which-rollback-do-i-need).

## 2. The launcher is down or erroring

**Symptoms**

- `app.invisiblewall.org` does not load, or answers 502.
- Sign-in fails, or tool pages error.
- Every published game shows "could not load", because they fetch their data from the launcher.

**First 5 minutes**

1. Check health:
   `curl -s -w '\n%{http_code}\n' https://app.invisiblewall.org/api/health`. Read `db` and
   `migrations.schema`.
2. Check for a push to `main` in the last few minutes. **Every push redeploys the launcher**, and
   until the Railway healthcheck is set, each deploy is a 1–2 minute gap while the container swaps
   (the launcher healthcheck box in [INFRA](../INFRA.md#services-railway)).
   - Read `/_app/version.json` to see whether the new build is up.
   - Read the commit status to see whether it deployed.
3. Railway → launcher → Deployments: the state of the latest build and its deploy log.
4. Sentry `launcher`: new issues, especially `area: migrate`.
5. If you only get timeouts, probe from outside Spain ([above](#first-is-it-spain)).

**Likely causes**

| What you found | Cause | Fix |
| --- | --- | --- |
| it comes back within ~2 minutes of a push | the deploy swap (no healthcheck yet) | nothing; setting the healthcheck ([status/infra](../status/infra.md), Blocked) closes the gap for good |
| 503, `db: down` | Postgres is down, or `DATABASE_URL` changed and was not applied | Railway → Postgres service status; **Apply changes / Deploy** on the launcher after any variable change |
| 503, `schema: behind` | a migration failed at boot; the new code expects a schema the database does not have | deploy log plus Sentry `area: migrate`. Redeploy the previous launcher deployment from Railway to restore service, and escalate. **Never** run `db:push` on production |
| the new build is taking a long time | deploys are uneven: some take minutes, some take half an hour; the old container keeps serving meanwhile | wait at least half an hour before treating it as stuck; re-pushing early only queues more builds ([INFRA](../INFRA.md#services-railway)) |
| a build failed with an empty build log | Railway's builder, not our code; the last good deploy stays live | deployment menu ⋮ → **Redeploy** |
| 502 during a bake or export | the launcher ran out of memory (a known item in [status/infra](../status/infra.md)) | it restarts by itself; retry the bake; report it |
| a new env var "does nothing" | the variable is staged, not applied | **Apply changes / Deploy** |
| data is wrong or gone | a bad write or a bad migration | stop and read [backups.md § B](backups.md#b-recover-the-production-database) before touching anything |

**Escalate** to the owner, who has the Railway access. Include the `/api/health` body, the deploy
log excerpt and the time.

## 3. Generation is failing

This covers the Atlas Maker, the Sheet Maker, the ComfyUI pods, RunPod and the tunnel.

**First, know which machine renders.** In the Atlas Maker, open ⚙ Global settings → **Run
generation on**:

- **blank:** the service default, which in production is the **RunPod Serverless** endpoint;
- **RunPod:** the same endpoint;
- **My computer:** your own ComfyUI, over the Cloudflare tunnel.

The R&D pods on `/comfyui` are a third, separate thing: interactive ComfyUI for building graphs,
never the Atlas Maker's render path. A production render failure is a RunPod or worker-image
problem, not "is the local ComfyUI up" ([atlas-maker](../tools/atlas-maker.md#prerequisites)).

**First 5 minutes**

1. `curl -s` the tool's `/healthz`. You should get `"ok": true` and the `commit` you expect.
   - No answer: Railway → atlas-tool (or sheet-tool) → deploy logs.
2. If the tool answers **403 "open … from the launcher"**, reopen it from the launcher.
   - If that fails for everyone, read the tool's boot log for the `[gate]` line. A signing-secret
     mismatch or a missing secret shows there ([rotate-a-secret](rotate-a-secret.md)).
3. Read the error text on the tile or in the log. A worker error ends with `[worker <sha>]`, which
   names the build that failed.
4. Check whether atlas-tool redeployed during the render. A push under `services/atlas-tool/` or
   `services/_shared/` swaps its container. The tool re-attaches at boot and collects finished
   renders from R2, so give it a few minutes before you re-run anything.
5. Export the RunPod endpoint's logs and search for `Exception during`. That line holds ComfyUI's
   one-line cause.
   - **The timestamps are the exporter's local time, not UTC.** Convert them before you match a
     line to a job.
   - A worker's boot line, `[handler] atlas-comfy-worker build <sha>`, says which image it runs.
6. Sentry `pipeline-tools`, filtered by the `service` tag.

**Likely causes**

| What you found | Cause | Fix |
| --- | --- | --- |
| `value_not_in_list`, or a missing node | the model or node is not on the machine that renders | [atlas-maker Troubleshooting](../tools/atlas-maker.md#troubleshooting); the "one caveat that bites" in [comfyui](../tools/comfyui.md#the-one-caveat-that-bites) |
| `error pulling image … denied` | the endpoint points at the wrong image, which happens more often than an expired registry token | the endpoint's image must be **`atlas-comfy-worker`**, never `atlas-comfy-pod` ([INFRA](../INFRA.md#environment-variables-names-only), the endpoint image box) |
| a worker fix you shipped "has no effect" | the endpoint is on `:latest`, which is cached by digest | set the endpoint to the immutable `:<sha>` tag, then confirm the sha in the boot log |
| Cancel says stopped, but RunPod keeps billing | `RUNPOD_ENDPOINT_ID` / `RUNPOD_API_KEY` are missing from the **endpoint's** env | set both on the endpoint (the worker logs a line when they are missing) |
| "lost contact with RunPod …" after a deploy | a container swap in the middle of a render | wait for the re-attach; don't push tool changes during a video session |
| *My computer*: "has never answered", or the render refuses at once | the local ComfyUI or `cloudflared` is not running. The tunnel is not a Windows service yet, so it does not survive a reboot | start ComfyUI and the tunnel from the desktop launcher; check with the `/system_stats` `curl` in the [INFRA rotation table](../INFRA.md#b92--rotation-checklist-for-setup-time-secrets) |
| *My computer* is refused as a misconfigured target | `COMFY_URL` points at a RunPod address | set `COMFY_URL` back to the tunnel ([INFRA](../INFRA.md#environment-variables-names-only)) |
| 403 from ComfyUI over the tunnel | the Access service token is wrong, or a client sent Python's default User-Agent | the same `curl` check; every code path already sends `InvisibleAtlas/1.0` |
| model dropdowns red, "unavailable" | nothing has ever been read for that machine | start any pod on `/comfyui`, press **⟳ Refresh model lists**, then stop the pod |
| R&D pod: Start fails with "not enough free GPUs" | a stopped pod does not reserve its card | start a different pod in the fleet ([comfyui](../tools/comfyui.md)) |
| R&D pod: the link is denied when clicked, but works when pasted | RunPod's proxy rejects cross-site navigations | give the pod `TCP 8188` ([INFRA](../INFRA.md#access-to-podid-8188proxyrunpodnet-was-denied--clicking-through-from-a-tool)) |
| R&D pod: "ComfyUI disconnected" | the progress socket dropped; the error is kept in `/history` | `node scripts/comfy-last-error.mjs <pod url>` ([INFRA](../INFRA.md#debugging-comfyui-disconnected-on-a-pod)) |
| R2 timeouts from a local tool or script, in Spain | the LaLiga block | [above](#first-is-it-spain) |

**Escalate** to the owner, who has the RunPod console. Attach the log export, the job or session
time in UTC, and the full error string.

## 4. RGS errors: spins fail

**Which RGS?** Look at the game URL:

- `rgs_url=games.invisiblewall.org/api/<key>` is **our mock RGS** on the test server. It is fake
  money.
- A launch through `/api/partner-session`, or a partner-hosted delivery build, talks to a **partner
  RGS** that speaks the Play4Fun protocol ([reference](../reference/play4fun-protocol.md)).

**Symptoms**

- A "reconnecting" overlay, which then turns into "connection lost" with a Reload button.
- The spin hangs.
- The balance is wrong.
- A partner game refuses to open.

**First 5 minutes**

1. Sentry `game-runtime`, `area: rgs`: the `action` (`authenticate`, `bet`, `endRound`) and the
   `status` (for example `ERR_HTTP_502`).
2. DevTools → Network, filter on `engine`. Read each request's HTTP status and body. **Partner
   failures usually arrive as HTTP 200 with an `error` in the body.** That is a refusal from their
   server, not a network problem.
3. Timeouts with no response at all: do the [Spain check](#first-is-it-spain) before anything
   else.

**Mock RGS (test server)**

| What you found | Cause | Fix |
| --- | --- | --- |
| `/healthz` down, or the game key missing | the test server is down or failed to read R2 | Railway → Invisible-test-Server logs; redeploy |
| the balance reset | expected: mock balances are per tab and reset on a restart or a publish | nothing |
| the board, paylines or win model are wrong | the mock follows the project's Game Config live (re-read about every 10 s), and falls back to the published manifest when the launcher cannot be reached | check the Game Config; check the launcher (§ 2) ([test-server](../tools/test-server.md)) |

**Partner RGS**

| What you found | Cause | Fix |
| --- | --- | --- |
| timeouts from Spain, evenings, DNS fine, `no-cors` also fails | the LaLiga block, not the partner | probe from outside Spain; wait it out; do **not** report an outage to the partner |
| a 200 with `not authorized` (code 118) | a real session-level refusal from their server | relaunch to mint a fresh session; if it persists, raise it with the partner |
| `/api/partner-session` answers 404 | no partner profile is configured for that delivery-profile id | check the `PARTNER_RGS` keys (owner) |
| `/api/partner-session` answers 500 | `PARTNER_RGS` is invalid JSON or is missing a field | fix the variable and apply it (owner). Never paste its contents in chat |
| `/api/partner-session` answers 502 | the partner refused, or answered badly, when asked for a session (for example `player not found` for a pool player they never created) | the message names their reason; raise it with the partner |
| a server-side `curl` to the partner is bounced | their node sits behind a Cloudflare challenge | probe from a real browser tab on the game origin instead |
| a player reports a double stake after a network drop | the browser re-sent a POST on its own over HTTP/1.1; the game cannot see it happen | collect the round ids; raise it with the partner ([reference](../reference/play4fun-protocol.md#resending--theirs-and-ours-2026-09-29)) |

**Escalate** to the engine lead for anything in the translator or the facade. Contact the partner
only once the Spain check says the problem is really on their side.

## After the incident

- Close the auto-opened issue once a run is green. Both workflows comment on the open issue rather
  than opening a new one, so a stale open issue hides the next failure.
- Record what happened and what fixed it in the affected tool's `docs/status/<tool>.md`, under
  "Recent changes". Use [status/infra](../status/infra.md) for platform incidents. Never append to
  `docs/history.md`.
- If a secret was pasted, screenshotted or logged while debugging, rotate it:
  [rotate-a-secret](rotate-a-secret.md).
- If the database or R2 needed a restore, record it the way
  [backups.md](backups.md#a-the-drill-prove-the-backups-restore-quarterly-and-after-any-key-change)
  asks.
