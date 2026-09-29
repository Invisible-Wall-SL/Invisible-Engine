# Release and rollback

How engine code reaches the online games, how to check that it did, and how to take it back. This
covers the **Runtime release** and **Runtime rollback** GitHub workflows, the canary pin, and how
an engine rollback differs from rolling back one game's content.

**Merging engine code to `main` is a deploy.** Every online game runs one shared engine bundle, the
`lines` runtime. A merge that touches `apps/lines/**` or `packages/**` starts a release within
seconds. When the release goes green, every online game is on the new engine. An engine PR is not
staged behind a separate step: verify it before you merge.

Desktop-built games and partner deliveries are not affected. They compile their own copy of the
engine, and take a change at their next build (see [Publish and deliver](publish-and-deliver.md)).

## How a release is stored

Everything is under `test_server/_runtime/` in R2. The layout is owned by
`apps/launcher-api/scripts/lib/runtime-releases.mjs`, and "Runtime releases" in
[games-deploy.md](../design/games-deploy.md#runtime-releases-the-online-games-engine) has the full
design.

| Key | What it is |
| --- | --- |
| `lines@<version>/` | One release: the whole `apps/lines` build. It is never changed after upload. `<version>` is the first 12 characters of the commit. A second release of the same commit gets a `-<time>` suffix. |
| `lines/current.json` | **The pointer.** It names the release every unpinned game serves. Writing it is the one step that makes a release live. |
| `lines/releases.json` | The release history, newest first. |
| `lines/release.json` | The status stamp the launcher's engine pill reads (`building`, `released`, and the last failure). It proves the upload, not that the release is being served. |

The newest 10 releases are kept, plus the current one, the previous one and any pinned release,
whatever their age. So a rollback never needs a rebuild: it only moves the pointer.

## When to use this runbook

- You are about to merge an engine PR, or one has just merged.
- The **"Runtime release failed: lines"** issue was opened, or the launcher's engine pill says
  **last release failed**.
- Online games broke after an engine merge, and you need the previous engine back.
- You want to try a release on one game before everyone gets it (a canary).

For a game whose **content** is wrong (layout, art, flow, text), use **Make live** in
[Publish and deliver](publish-and-deliver.md). The table at the end of this page says which
rollback you need.

## Permissions

| To do this | You need |
| --- | --- |
| Merge to `main` | a pull request, merged by squash. Merging needs write access to `Invisible-Wall-SL/Invisible-Engine`. |
| Run **Runtime release** or **Runtime rollback** by hand | write access to the repo on GitHub (Actions → *Run workflow*, or `gh workflow run`) |
| Read the engine pill, `/healthz` and the response headers | nothing: the pill is on every signed-in user's launcher home page, and the rest is public |
| Get the failure issue | **Watch** the repo (at least Custom → Issues). See [INFRA.md](../INFRA.md) under "Runtime-release failures → a GitHub issue". |

No step here needs R2 credentials on your machine. The workflows hold them as GitHub Actions
secrets.

## Where to look

| Surface | What it tells you |
| --- | --- |
| **Engine pill** in the launcher home page's header | `Engine deployed · <commit> · <age>`, plus `· up to date`, `· last release failed` or `· rolled back`. Also `Releasing engine…` while a release builds, and `Release pending · N ahead` when `main` has engine commits the live bundle lacks. Hover the pill for the full commit and the failure. |
| `https://games.invisiblewall.org/healthz` | `runtimes` gives the release each runtime's pointer named at the server's last refresh, for example `{"lines": "<version>"}`. `pinned` lists the games serving their own release. `lastHydrate.succeeded: false` means its last refresh failed, so it still serves the release it had before. |
| The **`X-Runtime-Release`** header on an online game's page | the release that answered, as `lines@<version>`. Only games on the shared runtime send it. Desktop builds do not. |
| The `bundle.<hash>.js` named in that page | the exact build being served. It is unique per build. |
| `__IE_BUILD__.sha` in an online game tab's console | the engine commit your browser actually loaded |
| Actions → **Runtime release** → the run | the gates, the build, and a final `LIVE after Ns — <game> serves bundle.<hash>.js from lines@<version>` |
| Actions → **Runtime rollback** with action `list` | every kept release (`CURRENT`, `previous`, `never live`), the pointer, and the pins |

A quick header check from a terminal (use any Game Maker game's key):

```bash
curl -sI "https://games.invisiblewall.org/<game key>/index.html?cb=$RANDOM" \
  | grep -i x-runtime-release
```

**Never fetch a bare `_app/immutable/bundle.<hash>.js` URL to check a release.** Fetched before the
server has the release, it answers a 404 with no cache headers, which a browser (or any cache in
between) may keep, on the exact file every game then needs. When `games` was behind the Cloudflare
proxy this held for hours; it is DNS-only today ([INFRA](../INFRA.md#dns-cloudflare)), but the
page check is the reliable one. Always load the page with a `?cb=` query, as above.

## 1. Before you merge an engine PR

1. **Run the release gates locally.** The release runs them anyway, but **Lint** is not a required
   check, so a PR can merge with it red.
   ```bash
   pnpm check:undefined-names
   pnpm check:engine-game
   pnpm check:rgs
   ```
   *Check:* all three pass. `check:undefined-names` is the one that matters most. A name that was
   never imported passes the build and breaks every online board.
2. **Play the change in a game.** A green build is not a working game.
3. **Decide whether published games need republishing.** If the change reads new data from a game's
   published content, the games need a republish after the release. Say so in the PR. See section C
   of [Publish and deliver](publish-and-deliver.md).
4. **For a risky change, use a canary first** (section 4), then merge.
5. **Merge.** Watch the release (section 2). Railway deploys the launcher and services from the same
   push, so one merge can move both.

## 2. Watch a release

1. **Find the run.** Actions → **Runtime release** shows a run for your merge commit within
   seconds.
   *Check:* the run exists. If the merge touched neither `apps/lines/**` nor `packages/**`, no run
   is expected. If the run ends in `startup_failure` or never starts, Actions itself did not run.
   Check the repo's Actions settings and billing, then release by hand (section 6).
2. **The launcher shows the release building.** The stamp is written once the gates pass, before
   the build starts.
   *Check:* the engine pill reads **Releasing engine…**.
3. **Wait for green.** The steps are: three gates (`Gate: no undefined identifiers`,
   `Gate: engine-game fixtures pass`, `Gate: rgs win models agree on money`), then the build, then
   *Publish to `_runtime/lines@<version>` and promote it*, then *Refresh the test server and verify
   the served bundle*. The last step polls a game that follows the pointer, and re-sends the
   refresh, for up to 15 minutes. The run is green only once that game serves the new bundle.
   *Check:* the run is green, and its last log line reads `LIVE after …`.
4. **Confirm it yourself.**
   *Check:* the `curl` above prints `x-runtime-release: lines@<first 12 characters of your commit>`,
   and `/healthz` shows the same version under `runtimes`. The pill reads `Engine deployed ·
   <your commit>`. In a browser, load a game with `?cb=1` added to its URL, then type
   `__IE_BUILD__.sha` in the console. It should start with your commit.
5. **Play one online game.** Spin, trigger what you changed, and watch the console. If Sentry is set
   up ([INFRA.md](../INFRA.md) under "Monitoring & error tracking"), watch its game-runtime project
   for new issues tagged with the new release.

If several engine PRs merge close together, GitHub runs one release at a time. A queued release can
be cancelled when a newer merge queues behind it, so the newest commit is the one that ends up
live. A cancelled run does not open an issue.

## 3. When a release fails

A failed run opens the **"Runtime release failed: lines"** issue, or comments on it if it is
already open, with the run link and the commit. The engine pill switches to **last release
failed**. Hover it: it says either *"… failed — the games stayed on the commit above"* or
*"… was made live but never confirmed served — check a game"*.

| Failed step | Which engine the games are on | Do this |
| --- | --- | --- |
| A **Gate**, or **Build** | The previous release. Nothing was uploaded. | Fix forward: open a PR against `main` and merge it. That merge releases again. |
| **Publish … and promote it**, with *"pointer moved"* | Whatever a rollback that ran meanwhile chose | Nothing to do. The rollback wins, by design. |
| **Refresh the test server and verify the served bundle** | The pointer names the new release, but the server may still be serving the old one | See "The release is green in R2 but games serve the old engine" below |
| The run was **cancelled** | The newer run's release | Nothing to do. No issue is opened. |

**Close the issue** once a release is green again.

### The release is green in R2 but games serve the old engine

Uploading a release is not the same as serving it. The test server reads R2 only when it boots and
when it receives `POST /refresh`, and it answers that request before it has refreshed. The release
job checks the served bundle for this reason. If a game still serves the old engine (the verify
step failed, or you see it yourself):

1. **Rule out your own cache.** Load the page with `?cb=<anything>`, or use a private window.
   *Check:* the `curl` above names the release you expect. If it does, the server is fine.
2. **Make the server refresh and prove it.** Run **Runtime rollback** with action `promote` and
   version = the release that should be live. Nothing moves when the pointer already names it, but
   the run still refreshes the server and waits until a game serves that release.
   *Check:* the run is green.
3. **If the test server is down or restarting,** `/healthz` does not answer 200. A merge to `main`
   also redeploys it on Railway, and it loads everything from R2 before it listens. Wait until
   `/healthz` answers, then repeat step 2. If it stays down, see
   [Incident first response](incident-first-response.md).
4. **There is no edge cache to purge.** `games` is DNS-only, straight to Railway, so the
   **Purge edge cache (whole zone)** button in `/admin` → *Edge cache & build* does nothing for it.
   A stale file after steps 1–3 is the server's own state: read `lastHydrate` on `/healthz`, and
   see [Incident first response](incident-first-response.md) for a refresh that failed.

## 4. Roll the engine back

1. **Pick the target.** Run Actions → **Runtime rollback** → *Run workflow* with action `list`,
   runtime `lines`.
   *Check:* the log shows the releases, the `CURRENT` one and the `previous` one.
2. **Roll back.** Run **Runtime rollback** with action `rollback` and runtime `lines`. Leave
   *version* empty to get the next older release that was ever live (a canary that was never
   promoted is skipped), or give a version or a commit prefix. From a terminal:
   ```bash
   gh workflow run runtime-rollback.yml -R Invisible-Wall-SL/Invisible-Engine -f action=rollback
   ```
   *Check:* the run is green. That takes about 45 seconds when the test server is up, and the run
   stays running until a game serves the chosen release. The log reads
   `rollback: 'lines' pointer <old> → <new>`.
3. **Confirm it.**
   *Check:* `X-Runtime-Release` and `/healthz` name the older release, and the engine pill reads
   **rolled back**. Play a game.
4. **Take the bad commit off `main`.** The rollback does not change `main`, and the next engine
   merge would release the bad commit again. Revert it (`git revert <sha>` on a branch, then a PR,
   then a merge). That merge releases the reverted code, which becomes the new live engine.
   *Check:* the revert's release goes green (section 2).
5. **Close the failure issue**, if one is open.

To roll forward again without a new merge, run action `promote`. Leave *version* empty for the
newest release, or name one.

Rolling the engine back does not change any game's published content. Make live does not change the
engine. Each rollback moves only its own layer.

## 5. Try a release on one game first (canary)

An auto-release on merge always makes its release live for everyone. A canary is a manual path.

1. **Upload without making it live.** Actions → **Runtime release** → *Run workflow*.
   *Use workflow from* is the branch that gets built. Set runtime `lines` and **untick
   `promote`**.
   *Check:* the run is green. It uploads and records the release but serves it to nobody, and the
   launcher does not show *Releasing engine…*.
2. **Pin one test game to it.** Run **Runtime rollback** with action `pin`, *game* = a test game's
   key and *version* = the new release (`list` shows it as `never live`).
   *Check:* the run is green. `/healthz` shows the game under `pinned`, and that game's
   `X-Runtime-Release` names the new release. Every other game is unchanged.
3. **Play the test game.**
4. **Then do one of these:**
   - **Ship it:** run action `promote` (empty version = the newest release), then run `unpin` for
     the test game so it follows the pointer again.
   - **Abandon it:** run `unpin` for the test game. Nothing else ever served it.

   *Check:* `/healthz` shows no leftover pin.

A pin survives a republish of that game. A forgotten pin keeps the game on that engine
indefinitely, and a pinned release is never pruned. `list` and `/healthz` show every pin. A
canary is not protected from merges: an engine merge during the canary still releases to everyone
else.

`pin` also works as a temporary hold-back: it keeps one game on the previous release while everyone
else moves on. Unpin it once the fix ships.

## 6. Release by hand

Use this when the automatic release did not run, or to re-release. Actions →
**Runtime release** → *Run workflow*, or:

```bash
gh workflow run runtime-release.yml -R Invisible-Wall-SL/Invisible-Engine -f runtime=lines
```

| Input | Default | Meaning |
| --- | --- | --- |
| `runtime` | `lines` | the runtime id, built from `apps/<id>` |
| `refresh` | ticked | refresh the test server and verify the new bundle is served. Unticked, the run proves only the upload. |
| `promote` | ticked | make it live. Unticked, it only uploads and records the release (a canary, section 5). |

Then follow section 2 from step 2.

## Which rollback do I need?

| What happened | What to use |
| --- | --- |
| One game looks or plays wrong since someone published it | **Make live** on its previous version ([Publish and deliver](publish-and-deliver.md), section B) |
| Every online game broke right after an engine merge | **Runtime rollback** → `rollback` (section 4), then revert on `main` |
| One online game broke after an engine merge, and the others are fine | The engine is shared, so it is still an engine problem. Roll back if players are affected, or `pin` that game to the previous release as a stopgap (section 5), then fix forward. |
| The mock RGS deals or pays the wrong math | Neither. Players' mock follows the game's published version, and **Live ↗** the saved Game Config. Fix it in `/config`, check it on **Live ↗**, then publish. |
| A desktop-built game or a partner delivery is broken | Neither. Those builds carry their own engine. Fix it, then ☁ Publish or 📦 Deliver again. |
| Something broke and nobody published or merged | Neither, yet. See [Incident first response](incident-first-response.md). |
| Authored files or the database were lost or corrupted | A restore: [Backups and restores](backups.md) |

|  | Content: **Make live** | Engine: **Runtime rollback** |
| --- | --- | --- |
| Moves | one game's published version (`<client>/<project>/published/pointer.json`), and with it the math the players' mock RGS deals | the shared engine pointer (`test_server/_runtime/lines/current.json`), or one game's pin |
| Affects | that one game | every online game not pinned |
| Where | `/game-maker` → the card → **Published versions** | GitHub Actions → **Runtime rollback** |
| Who | `gamePublish` holders with access to the project | anyone with write access to the repo |
| Takes effect | on each player's next load | when the run goes green, about 45 seconds |
| Kept | 5 versions per game | the newest 10 releases, plus the current, previous and pinned ones |
| Undo | **Make live** on the newer version | `promote` |
| Leaves alone | the engine | every game's published content, and `main` |

## Related

- [Publish and deliver](publish-and-deliver.md): publishing content, Make live, and desktop builds.
- [Incident first response](incident-first-response.md): a game is blank, stale or down.
- [Build your first game](build-your-first-game.md): the authoring walkthrough.
- [Backups and restores](backups.md): restoring data. Runtime releases are not backed up, because
  they are rebuilt from git by re-running **Runtime release**.
- "Runtime releases" in
  [games-deploy.md](../design/games-deploy.md#runtime-releases-the-online-games-engine): the
  design, races and retention.
- [INFRA.md](../INFRA.md): monitoring, health endpoints and the failure issue.
- [status/engine](../status/engine.md): the engine's current state and recent releases.
- The workflows: [`runtime-release.yml`](../../.github/workflows/runtime-release.yml) and
  [`runtime-rollback.yml`](../../.github/workflows/runtime-rollback.yml).
