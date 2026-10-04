# Rotate a secret

How to replace any credential we hold, in the right order, without breaking the services that
use it, and how to prove the new value took. Written so that anyone with dashboard access can do
it without asking the person who set it up.

Names and locations only. **Never paste a secret value into a doc, an issue, a PR, a commit or a
chat.** The repo is public, and so are its Actions logs.

Related:

- [INFRA.md](../INFRA.md): the service map, the env var names, and the setup-time rotation table
  ([§ Security / secret rotation](../INFRA.md#security--secret-rotation)). This guide links to
  that table instead of repeating it, and adds the consumers, the order and the verification.
- [backups.md § E](backups.md#e-a-key-or-token-is-compromised-or-lost): what to do when a backup
  key or token leaks.
- [incident-first-response.md](incident-first-response.md): when something broke and you do not
  yet know why.

## When to rotate

- A value was exposed: pasted in a chat, shown in a screenshot or a stream, committed, or printed
  in a log.
- Someone who held it leaves, or a machine that stored it is lost.
- A provider or the secret scanner (`scripts/check-secrets.mjs`, the `Secrets` workflow) reports
  it.
- The owed setup-time rotations in [status/infra](../status/infra.md) under "Blocked".

If you suspect active misuse, revoke first and repair the consumers afterwards. An outage is
cheaper than a leaked write key.

## The general procedure

1. **Find the secret's entry below.** It names every consumer. Grep for the env var name before
   you trust any list, including this one:

   ```bash
   git grep -n "NAME_OF_THE_VAR" -- apps services scripts .github
   ```

2. **Pick the pattern.** Each entry says which one applies.
   - **Overlap.** The provider lets an old and a new credential work at the same time (R2 tokens,
     API keys, GitHub tokens). Create the new one, move every consumer to it, verify, and only
     then revoke the old one. Nothing breaks.
   - **Single value.** The secret is one string that two ends must agree on, and our code accepts
     exactly one (the tool signing secrets, `TEST_SERVER_SECRET`, the deploy token, the Postgres
     password). There is a window between the first end and the last end changing. Keep it short,
     do it when nobody is mid-task, and expect the breakage the entry describes.
3. **Make the new value.** A provider credential comes from the provider's dashboard. A secret we
   invent ourselves is a long random string, for example `openssl rand -base64 48`. Never reuse
   another secret's value.
4. **Update every consumer.**
   - **Railway:** most shared secrets are Shared Variables (project → Settings → Shared
     Variables, environment `production`), so one edit reaches every service that references
     them. Before you rely on that, open each consumer service's Variables tab and check that it
     does not hold its own copy of the var, which would shadow the shared one.
   - A change only **stages**. Click **Apply changes / Deploy** on every affected service; a plain
     Redeploy does not apply staged variables (the "Railway gotcha" box at the end of
     [INFRA § Auto-migrate on boot](../INFRA.md#auto-migrate-on-boot-2026-06-13)).
   - **GitHub:** Settings → Secrets and variables → Actions for repo secrets. The `backups`
     environment holds its own secrets.
   - **Everything else:** RunPod, the owner's machine and the owner's password manager. The entry
     names them.
5. **Verify the runtime, not the dashboard.** Each entry gives a check that exercises the new
   value. After you revoke an old value (the overlap pattern), run the check again, so you know
   nothing was still quietly using it.
6. **Record it.** Add a dated line to [status/infra](../status/infra.md) under "Recent changes":
   which secret, why, and where it was changed. Never the value. If the rotation was an owed item
   under "Blocked" there, strike it.

## Where secrets live

| Holder | What it holds |
| --- | --- |
| Railway Shared Variables (`production`) | `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`, `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET`, `COMFY_ORG_API_KEY`, `ATLAS_TOOL_SIGNING_SECRET`, `SHEET_TOOL_SIGNING_SECRET`, and until the cut-over the legacy `ATLAS_TOOL_SECRET` / `SHEET_TOOL_SECRET` |
| Railway **launcher** | `DATABASE_URL`, `EDITOR_DOC_SECRET`, `RUNPOD_API_KEY`, `GIT_CLONE_TOKEN`, `GITHUB_ENGINE_READ_TOKEN`, `GITHUB_ACTIONS_TOKEN`, `CF_API_TOKEN`, `CF_ANALYTICS_TOKEN`, `RAILWAY_API_TOKEN`, `ANTHROPIC_API_KEY`, `LOCALIZATION_LLM_API_KEY`, `ANTHROPIC_ADMIN_API_KEY`, `OPENAI_ADMIN_API_KEY`, `PARTNER_RGS`, `ATLAS_BLUEPRINT_SECRET` (legacy), `SENTRY_DSN`, `PUBLIC_SENTRY_DSN`, `TEST_SERVER_SECRET` if set, `PIPELINE_CI_TOKEN` |
| Railway **atlas-tool** | the shared R2, CF Access, comfy.org and atlas signing vars; `RUNPOD_API_KEY`; `ATLAS_BLUEPRINT_SECRET` (legacy); `SENTRY_DSN` |
| Railway **sheet-tool** | the shared R2 and sheet signing vars; `SENTRY_DSN` |
| Railway **Invisible-test-Server** | `R2_*` (it only reads); `TEST_SERVER_SECRET` if set |
| GitHub Actions repo secrets | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `TEST_SERVER_SECRET` (runtime release and rollback), `PUBLIC_SENTRY_DSN` (baked into the game runtime) |
| GitHub environment `backups` | the five backup secrets; the age public keys are a variable ([INFRA § Backups](../INFRA.md#backups-2026-09-29)) |
| RunPod | the Serverless endpoint's environment variables (`RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`); a Container Registry Credential (a GitHub token that can read our private GHCR images) |
| Launcher database | the deploy token (`app_settings`, key `deployToken`); each project's read token; user password hashes and sessions |
| R2 | the tunnel credential bundle at `tools/invisible-launcher/cloudflared-bundle.json` |
| The owner | the age identities (password manager plus an offline copy); the tunnel credentials in `~/.cloudflared/`; the desktop launcher's optional direct-to-R2 key; env for owner-run scripts |

`GITHUB_TOKEN` in the workflows is issued per run by GitHub. There is nothing to rotate.

**Not secrets:** `R2_ENDPOINT`, `R2_BUCKET`, `CF_ACCESS_CLIENT_ID` on its own, `CF_ZONE_ID`,
`CF_ACCOUNT_ID`, `RAILWAY_PROJECT_ID`, `RUNPOD_ENDPOINT_ID`, pod ids and the age *public* keys.
Changing these is configuration, not rotation.

## Per-secret entries

Each entry lists where the secret **lives**, its **consumers**, the **order** to change it in, and
how to **verify** the change.

### R2 main token (`R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`)

How to create and revoke it: [INFRA rotation table](../INFRA.md#b92--rotation-checklist-for-setup-time-secrets),
first row. Pattern: **overlap**.

**Consumers.** The INFRA row names them in short. In full:

- **Railway:** the launcher, atlas-tool, sheet-tool and Invisible-test-Server.
- **GitHub Actions repo secrets:** `runtime-release.yml` and `runtime-rollback.yml` both read and
  write R2 with them. Miss these and the next engine merge fails its release. Online games stay on
  the old engine, and the "Runtime release failed: lines" issue opens.
- **Owner-run scripts,** from the owner's shell:
  - `scripts/seed-comfyui-models.py`
  - `apps/launcher-api/scripts/seed-tunnel-bundle.mjs`
  - `apps/launcher-api/scripts/verify-runtime-live.mjs` and the runtime pointer scripts
  - `services/atlas-tool/runpod/pull-models.py` and `push-models.py`, which are pasted onto a pod
    with the key in their env
  - the restore commands in [backups.md § C and § D](backups.md#c-recover-one-projects-docs-or-a-single-file)
- **The owner's desktop launcher,** only if its opt-in "Publish games straight to R2" or the
  owner-only publish buttons hold a copy. Since launcher v1.0.56, no other publisher's machine
  needs the key ([status/launcher](../status/launcher.md), 2026-09-29).

**Order.**

1. Create the new token with the same scope: bucket `invisibleassets`, read and write.
2. Update the Shared Variable, then **Apply changes / Deploy** on each Railway consumer.
3. Update the two GitHub repo secrets.
4. Update the owner's desktop launcher and any saved shell env.
5. Verify, below.
6. Delete the old token in Cloudflare, then verify again.

**Verify.**

- **Launcher:** open a project in the Game Maker or the Editor (both read R2), and publish a
  throwaway change (a write).
- **atlas-tool / sheet-tool:** open each from the launcher and load a project. The Railway deploy
  log should show no R2 errors during the boot hydrate.
- **Test server:** after its redeploy, `curl -s https://games.invisiblewall.org/healthz` must
  answer 200 with the games under `games` and `lastHydrate.succeeded: true`. A 503 `"ok":false`
  means its first R2 read failed (it retries in the background).
- **GitHub:** Actions → **Runtime rollback** → Run workflow with action `list`. It only reads R2.

From a Spanish connection, R2 connect timeouts during football matches are a Cloudflare IP block,
not a bad key ([INFRA § R2](../INFRA.md#r2-cloudflare-object-storage)). Check from elsewhere
before you roll back a rotation.

### Postgres password (inside `DATABASE_URL`)

How to change it: [INFRA rotation table](../INFRA.md#b92--rotation-checklist-for-setup-time-secrets),
second row. Pattern: **single value.** Connections that are already open keep working, but new
ones fail until each consumer carries the new password.

**Consumers:**

- the launcher's `DATABASE_URL`;
- `BACKUP_DATABASE_URL` in the `backups` environment, but only if it was set to the superuser URL
  instead of the `backup_reader` role;
- anyone's local `apps/launcher-api/.env` used for a manual migration (gitignored; tell them).

**Order.** Change the password, then apply and deploy the launcher at once. Do it outside working
hours: until the new container is up, requests that need a new connection fail.

**Verify.**

- `curl -s https://app.invisiblewall.org/api/health` returns `"db":"ok"` and
  `"schema":"current"`.
- Sign in.
- If `BACKUP_DATABASE_URL` was affected: Actions → **Nightly backup** → Run workflow, and it must
  finish green.

### Cloudflare Access service token (`CF_ACCESS_CLIENT_SECRET`, sometimes `CF_ACCESS_CLIENT_ID`)

How to change it: [INFRA rotation table](../INFRA.md#b92--rotation-checklist-for-setup-time-secrets),
third row.

**Pattern: overlap.** Create a second service token, allow it in the Access policy in front of
`comfy.invisiblewall.org`, move the consumers to it, then remove the old token from the policy
and delete it.

**Consumers:**

- atlas-tool (`iw_common.comfy.cf_headers()`, used when **Run generation on** is *My computer*).

Production generation runs on RunPod and never sends these headers. A broken value therefore only
shows up on the *My computer* path, which is exactly why it can go unnoticed. Test it
deliberately.

**Verify.**

- Run the `curl … /system_stats` check from the INFRA row. The local ComfyUI and the tunnel must be
  up.
- Or, in the Atlas Maker: ⚙ Global settings → **Run generation on** = *My computer* → **⟳ Refresh
  model lists**.

### ComfyUI tunnel credentials (`cloudflared`)

**Not in the INFRA table.**

**Lives in:**

- the owner's `~/.cloudflared/` (the credentials file and `cert.pem`);
- a copy in R2 at `tools/invisible-launcher/cloudflared-bundle.json`. The desktop launcher fetches
  it for admins, to set up a new machine;
- every machine that fetched that bundle.

**Order.**

1. Replace the tunnel's credentials in Cloudflare Zero Trust. If you create a new tunnel instead,
   route `comfy.invisiblewall.org` to it.
2. Update `~/.cloudflared/` on the owner's machine.
3. Re-seed the R2 copy with `node apps/launcher-api/scripts/seed-tunnel-bundle.mjs` (needs the
   `R2_*` env), so the next machine gets the new files.
4. Have every other machine that runs the tunnel re-provision through the desktop launcher.
5. If the tunnel id changed, tell whoever maintains INFRA.md, and update the script's default id.

**Verify.** Run the same `/system_stats` check as the Access token above. It must pass through the
new connector.

### Tool launch signing secrets (`ATLAS_TOOL_SIGNING_SECRET`, `SHEET_TOOL_SIGNING_SECRET`)

What they do and how they were first set:
[INFRA § Tool launch tokens](../INFRA.md#tool-launch-tokens--atlas-tool--sheet-tool-2026-09-29).
Pattern: **single value. The code has no old-and-new window:** `services/_shared/iw_common/launch.py`
and `apps/launcher-api/src/lib/server/toolLaunch.ts` each read exactly one secret.

**Consumers:**

- The launcher: it signs the redirect token for `/atlas` and `/sheet`, and the server-to-server
  token of the Flipbook video proxy.
- The matching tool: it verifies the token and signs its own 12-hour session cookie with the same
  secret.

**Order.**

1. Each secret is one Shared Variable referenced by both ends. Change it once.
2. Apply changes on the launcher and the tool back to back.
3. Until both are live, opening the tool gives 403 "open … from the launcher", and the Flipbook's
   video mode cannot reach the Atlas Maker.
4. Once both are live, every existing session of that tool has ended. Users reopen it from the
   launcher; nothing else needs cleaning up.
5. Do it when no Atlas Maker render or video session is running. A Railway rollout of atlas-tool
   swaps the container anyway.

The INFRA setup note "set the tool side first" applied to the first setup, when the legacy handoff
still covered the gap. For a rotation that order buys nothing.

**Verify.**

- The tool's deploy log prints `[gate] signed launch tokens (…)` at boot.
- `/healthz` shows the new `commit`.
- Open the tool from the launcher, then open the Flipbook's video mode.

Never unset a signing secret without its replacement. With the legacy secret gone as well, a
Railway tool refuses every request except `/healthz` (`[gate] ERROR: neither … is set`).

### Legacy tool handoff secrets (`ATLAS_TOOL_SECRET`, `SHEET_TOOL_SECRET`, `ATLAS_BLUEPRINT_SECRET`)

**Remove them. Do not rotate them.**

1. Set `IW_LEGACY_TOOL_KEY_UNTIL=off` on atlas-tool and sheet-tool, then apply.
2. Check the boot log reads `legacy ?k= refused`.
3. Delete the three vars from Railway (the launcher and the tools).

After 2026-10-13 the tools refuse the legacy handoff on their own, but the values still sit in
Railway until someone deletes them. Removing the dead branch in `launch.py` and `toolLaunch.ts` is
tracked in the atlas-maker and sheet-maker status files.

### Deploy token (`app_settings.deployToken`, bootstrap `EDITOR_DOC_SECRET`)

The [INFRA rotation table](../INFRA.md#b92--rotation-checklist-for-setup-time-secrets) has the
short row. This entry adds every consumer.

**Lives in:**

- the launcher database, managed in **/admin → Settings → Deploy token** (reveal, set, rotate);
- the launcher env var `EDITOR_DOC_SECRET`. It is only the fallback, but
  `getDeployToken()` (`appSettings.ts`) returns to it whenever the database read fails.

**Consumers:**

- the build and read endpoints (`/api/editor/doc`, `/api/editor/runtime`, `/api/deploy/…`, the
  `export-*` endpoints, localization strings);
- the desktop launcher, which fetches the token fresh through `/api/launcher/deploy-token` (users
  with `gamePublish`);
- anything that saved a copy: build env or CI that runs `bake-editor-doc.mjs`,
  `pull-project-assets.mjs` or `publish-symbol-defaults.mjs` (`EDITOR_DOC_SECRET` or
  `LIVE_ASSETS_TOKEN`), and local shells.

**Pattern: single value.** It takes effect on the next request.

**Order.**

1. Press **Rotate** in /admin.
2. Set `EDITOR_DOC_SECRET` on the launcher to the new value too, then apply. Otherwise a database
   hiccup would quietly re-enable the old value.
3. Update every saved copy.

Published Game Maker games are **not** affected: their URLs carry the project's own read token.
Any game URL that carries the deploy token as `?k=` stops on "This game could not load" until it
is re-issued.

**Verify.**

- /admin shows the new masked token.
- A desktop build or a bake completes.
- `/api/editor/doc?project=<key>&k=<old value>` answers 401.

### Per-project read tokens (`projects.read_token`)

The read token in a published game's URL gives read-only access to that project's published data,
which is public game content anyway. **The code has no rotation path yet** ("rotation is a future
admin op", `projects.ts`). The token is embedded in the game's launch URL and in the test server's
`games.json` pin, so changing it by hand breaks the game until it is re-registered. Ask a
developer. Do not edit the row yourself.

### `TEST_SERVER_SECRET`

Optional: when it is set, the test server's `POST /refresh` demands it, as the
`x-test-server-secret` header or `?secret=`. `.github/workflows/runtime-release.yml` says to add
the GitHub secret "only if the test server sets one". Whether production sets it is not recorded
in the docs: look at the Invisible-test-Server service's Variables in Railway.

**Consumers:**

- the test server (`services/test-server/server.mjs`);
- the launcher (Railway var of the same name), which sends it as a header on Game Maker
  Publish's and `register-game`'s refresh (`src/lib/server/testServerRefresh.ts`);
- the GitHub repo secret, used by `runtime-release.yml` and `runtime-rollback.yml` through
  `apps/launcher-api/scripts/lib/runtime-releases.mjs`;
- the owner's `publish-game-via-portal.mjs` (`--refresh-secret`, or the env var);
- possibly the desktop launcher. It lives in the separate `invisible-launcher` repo, so check
  there.

If the launcher's copy is missing or stale, a Game Maker Publish still succeeds but its refresh
gets a 403, and the game goes live only on the test server's next hydrate.

**Pattern: single value.** Update the GitHub secret and both Railway vars (test server and
launcher) together, while no Runtime release or rollback is running. Otherwise that run's live
check times out and opens a "Runtime release failed" issue.

**Verify.** With the new value in `$TEST_SERVER_SECRET`, this must answer 202. Send it as the
header, as the launcher does, so the value never sits in a URL or an access log:

```bash
curl -s -X POST -H "x-test-server-secret: $TEST_SERVER_SECRET" \
  "https://games.invisiblewall.org/refresh"
```

The old value must answer 403. A launcher left on the old value shows no error anywhere (Publish
ignores the refresh's answer), so compare the two Railway values by eye as well.

### `PIPELINE_CI_TOKEN`

The bearer token for the read-only `GET /api/pipeline/games`, the game list the current-games
regression harness runs against (`docs/director/DECISIONS/0004-current-games-regression-harness.md`).
It opens nothing else. Unset on the launcher, the endpoint answers 503.

**Consumers:**

- the launcher (Railway var), compared in `src/lib/server/pipelineGames.ts`;
- the GitHub repo secret of the same name, used by the harness workflow once it exists.

**Pattern: single value.** A new random value (`openssl rand -hex 32`) in both places; a harness
run between the two updates gets a 401 and fails visibly.

**Verify.** With the new value in `$PIPELINE_CI_TOKEN`, this must answer 200, and the old value 401:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $PIPELINE_CI_TOKEN" \
  "https://app.invisiblewall.org/api/pipeline/games"
```

### RunPod API key (`RUNPOD_API_KEY`)

The INFRA rotation table has the short row. Pattern: **overlap**. Create the new key before you
revoke the old one.

**Consumers:**

- The **launcher:** the `/comfyui` start, stop and probe, **Update to `<sha>`**, idle auto-stop,
  and Admin → Costs.
- **atlas-tool:** serverless submit, status and cancel (`batch_atlas.py`, `runpod_control.py`),
  and the pod discovery behind **⟳ Refresh model lists**.
- The **Serverless endpoint's own environment variables** in RunPod. The worker uses the key to
  notice a cancel (`services/atlas-serverless/handler.py`). If you forget this one, Cancel reports
  success while the worker keeps rendering and billing (the "serverless WORKER needs" box in
  [INFRA § Environment variables](../INFRA.md#environment-variables-names-only)).

**Order.**

1. Create the new key.
2. Set it on the launcher and atlas-tool, and apply.
3. Set it in the endpoint's environment variables.
4. Verify, below.
5. Revoke the old key, then verify again.

**Verify.**

- `/comfyui` shows real pod states, with no RunPod error line.
- Admin → Costs shows the RunPod balance.
- An Atlas Maker render on RunPod completes.
- Cancel a second render: the job must actually stop in the RunPod console. The worker logs a line
  at its first cancel check if the key is missing.

### RunPod registry credential (a GitHub token that can read our images)

**Not in the INFRA table.** Both GHCR images are private. The RunPod Container Registry
Credential is what lets the Serverless endpoint pull `atlas-comfy-worker`, and lets a pod pull
`atlas-comfy-pod`.

**Pattern: overlap.**

1. Create a new GitHub token with `read:packages`.
2. Update the RunPod credential.
3. Confirm that a freshly started worker boots. Its log prints
   `[handler] atlas-comfy-worker build <sha>`.
4. Revoke the old token.

An `error pulling image … denied` more often means the endpoint points at the wrong image name
than at a dead token, so check the name first (the "endpoint's image" box in
[INFRA § Environment variables](../INFRA.md#environment-variables-names-only)).

### comfy.org API key (`COMFY_ORG_API_KEY`)

[INFRA § B9.2](../INFRA.md#b92--rotation-checklist-for-setup-time-secrets) covers
revoking it at platform.comfy.org. Pattern: **overlap**.

**Consumers:**

- atlas-tool, from the env;
- the Atlas Maker's own **⚙ Global settings** field "comfy.org API key". The env var overrides
  that field, but a value typed there is stored, so clear it;
- the desktop Atlas Maker's env.

The key travels inside each job to ComfyUI, so nothing on RunPod stores it.

**Verify.**

- The Atlas Maker's credits chip shows a balance.
- A `gpt_image` render succeeds.

### GitHub tokens on the launcher (`GIT_CLONE_TOKEN`, `GITHUB_ENGINE_READ_TOKEN`, `GITHUB_ACTIONS_TOKEN`)

Pattern: **overlap**. Create the new token, set it, apply, verify, then revoke the old one. What
each token does and which permissions it needs is in
[INFRA](../INFRA.md#environment-variables-names-only) (the "release pending" note) and in the
`/comfyui` env table.

- **`GIT_CLONE_TOKEN`** is served to desktop launchers with `gamePublish`, for zero-login clones
  of game repos.
  - It is also the fallback for the other two tokens. Revoking an old clone token can break the
    Rebuild button or the release pill if those were quietly falling back to it.
  - Verify: a desktop **Sync** of a private game repo.
- **`GITHUB_ENGINE_READ_TOKEN`** feeds the launcher home's "release pending" pill.
  - When it fails, the pill silently never says pending, so an error will not warn you.
  - Verify: after a merge touching `apps/lines/` or `packages/`, and before its release finishes,
    the pill must show pending.
- **`GITHUB_ACTIONS_TOKEN`** powers **Rebuild image** on `/comfyui`.
  - Verify: the **Pod image** line lists the newest CI build. A 403 in that panel names the
    missing permission.

### Cloudflare API tokens (`CF_API_TOKEN`, `CF_ANALYTICS_TOKEN`)

Pattern: **overlap**. Both are read by the launcher only.

- **`CF_API_TOKEN`**, the zone cache purge.
  - `games` and `app` are DNS-only today, so the purge has nothing of ours to drop. The token only
    matters if `games` is ever put behind the Cloudflare proxy (the "Game freshness" note in
    [INFRA](../INFRA.md#environment-variables-names-only)). A broken token breaks nothing visible.
  - Verify: /admin → purge the edge cache, and it must report success. That purges the whole
    `invisiblewall.org` zone. It is harmless, but do it off-peak.
- **`CF_ANALYTICS_TOKEN`**, account analytics for Admin → Costs.
  - Verify: the R2 card on Admin → Costs shows figures.

### Other launcher API keys

All of these are **overlap**, launcher-only, and degrade to a message rather than an outage.

| Var | Used by | Verify |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Localization **Translate** (the Anthropic path); also the local `scripts/i18n-translate.mjs`, which reads `OPENAI_API_KEY` instead with `--provider openai` (a personal key in your own shell; nothing stores it) | translate one row in `/localization` |
| `LOCALIZATION_LLM_API_KEY` | Localization **Translate**, when the OpenAI-compatible provider is configured (it wins over Anthropic) | the same |
| `ANTHROPIC_ADMIN_API_KEY`, `OPENAI_ADMIN_API_KEY` | Admin → Costs, read-only | the provider's card shows spend |
| `RAILWAY_API_TOKEN` | Admin → Costs, the Railway card | the card shows usage |

### Partner RGS credentials (`PARTNER_RGS`)

A JSON map on the launcher that holds a **partner's admin credentials** for minting player
sessions (`partnerRgs.ts`). The password is the partner's to change, so agree the switch with
them.

**Order.**

1. Put the new JSON on the launcher and apply. **Do not** paste it in an issue or a chat.
2. Tell the partner to retire the old credentials.

**Verify.** Launch a game card that uses that delivery profile. It must redirect into a booting
game. When minting fails, `/api/partner-session` answers 502 with the partner's reason ("Partner
RGS refused the session: …").

### Sentry DSNs (`SENTRY_DSN`, `PUBLIC_SENTRY_DSN`)

A DSN only lets someone **send** events. Rotate it when it is being abused (spam, or a quota being
burnt), not because it appeared in a browser. The browser DSNs are public by design. Pattern:
**overlap:** in Sentry → the project → Client Keys, create a new key, move the consumers, then
disable the old key.

- **Launcher:** `SENTRY_DSN` and `PUBLIC_SENTRY_DSN` on Railway. Read at runtime, so applying the
  change is enough.
- **atlas-tool, sheet-tool:** `SENTRY_DSN` on Railway.
- **Game runtime:**
  1. Update the GitHub repo secret `PUBLIC_SENTRY_DSN`. It is baked in at build time, so nothing
     changes until the next runtime release.
  2. Run **Runtime release** by hand (Actions → Run workflow), rather than waiting for an engine
     merge.
  3. Delivery builds keep the DSN they were built with until they are rebuilt. Disabling the old
     key drops their events.

**Verify:** new events arrive in each Sentry project after the deploy.

### Backup tokens and age keys

How to rotate them: the backup rows of the
[INFRA rotation table](../INFRA.md#b92--rotation-checklist-for-setup-time-secrets), and
[backups.md § E](backups.md#e-a-key-or-token-is-compromised-or-lost) for a leak. Those rows are
complete.

**Verify:** Actions → **Nightly backup** → Run workflow must finish green, with no new "Nightly
backup failed" issue. After an age key change, also run drill A with the new key.

### Launcher user accounts

A person's password or session, rather than a service credential.

- **/admin → Users → Reset password** sets a new password and signs that user out everywhere.
- **Revoke all sessions** signs them out without changing the password.

Desktop-launcher sign-ins are the same sessions, so they end as well.

### Leftovers: delete, don't rotate

- **`RESEND_API_KEY`**: no code reads it, and INFRA's env tables dropped it. If it still exists
  in Railway, delete it and revoke it at the provider.
- **`HF_TOKEN`** is read only by `fetch-models.py` on a pod, for a gated Hugging Face repo. None
  is gated today, and nothing stores it. If one was ever pasted onto a pod, revoke it on Hugging
  Face.
