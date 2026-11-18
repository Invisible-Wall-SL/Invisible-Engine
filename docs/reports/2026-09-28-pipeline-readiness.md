# Pipeline production-readiness report — 2026-09-28

> **Snapshot, 2026-09-28 → 2026-10-01.** Written during the readiness sprint and committed
> afterwards as a record. Every security finding in §2 was closed during the sprint; §2 keeps
> only what was found and which change fixed it, not how it could have been used.
>
> **What this is:** a dated snapshot, not a living doc. The per-tool `docs/status/<tool>.md`
> files remain the source of truth for current state. Where this report found them wrong, the
> correction is listed in [Appendix B](#appendix-b--doc-drift-found-for-docs-keeper) so it can be
> folded back into the right file.
>
> **How it was made:** eight parallel read-only audits, each covering a slice of the pipeline.
> They read the status, design and guide docs, **checked the claims against the code** at `main`
> `7775e83d`, measured git churn since 2026-08-15, ran the offline test suites that need no install,
> and made a handful of unauthenticated status-code probes against live URLs. Every headline finding
> in §1–§2 was then re-checked by hand. Nothing was edited, deployed or exploited.
>
> **What it could not see:** live R2 contents, the Railway / Cloudflare / RunPod dashboards, the
> partner's environment, and real devices. Everything that depends on them is marked
> **(unverified)** or listed in [Appendix A](#appendix-a--owner-to-confirm-dashboard-only-facts).

---

## 0. Progress log (updated as task sessions finish)

| Date | Item | State | Detail |
|---|---|---|---|
| 2026-09-28 | Force-always Save in `/symbols`, `/fx`, `/localization` (§4.3, roadmap #4) | ✅ Merged + live | [PR #821](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/821), merged as `3354b50e` (docs note in #823). All three buttons now call `() => save()`, and no other boolean-first handler was found. The new CI guard `check:event-bound-flags` runs in Lint (414 files, ok). Railway deploy succeeded. The live client chunks now route each Save through a wrapper instead of binding the force-save function directly. The compiled `SaveState` checked against a stub server with a stale ETag shows the conflict prompt. **Still owed (owner, 2 min):** a real two-tab conflict check in the browser. |
| 2026-09-28 | Launcher isolation and authz gaps a–i (§2.1) | ✅ Merged + live (18:29 UTC) | [PR #826](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/826), merge `c8b2954c`; docs in [#828](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/828). Changes by item: **(a)** `git-credentials` is gated on `gamePublish`; non-publishers fall back to an interactive git login. **(b)** was already live via #818. **(c)** the lease's project half was already live via #814; this adds the tool check (the caller must hold the lease's tool), and the flipbook, fx and flow-v2 pages now respect per-user overrides. **(d)** create and duplicate need a grant on the destination client; the pickers are filtered to match. **(e)** was already live via #812. **(f)** `partner-session` only mints for a global or accessible card, else 404. **(g)** an `adminPanel` holder can't grant admin, act on an admin's account, or edit the admin tool matrix. **(h)** `resetPassword` revokes the user's sessions. **(i)** the DB browser masks `app_settings` values unless the key is allow-listed. **Checks:** `check:launcher-gates` 221 → 292 and `check:lease-scope` 14 → 26. **Verified live:** 401s and redirects when signed out, build `c8b2954c` served. **Owed:** signed-in refusal probes, which need a non-admin test account. **Owner:** grant `gamePublish` to developer and pipelineTester. The lease query cost grew by two override reads. |
| 2026-09-28 | Rigger `.irig` save hardening (§4.2) | ✅ Merged + live | [PR #832](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/832), squash `dd31c4f4`; docs in [#834](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/834). **Save:** conditional, using If-Match / If-None-Match plus `projectKey`; a scope mismatch is a 409 that can't be overridden. On conflict, the overwrite retries against the exact version shown. **Validation:** the client re-parses with the tolerant loader, and the server's `irigDocProblem` returns a 422 with a reason. **Backups:** 20 rolling backups per rig at `rigger-backups/`, with a 🕘 History modal to restore. **Other:** a `beforeunload` guard, and the shared rig library is create-only unless confirmed. **Tests:** `irig-save.mjs` 45/45, and all 153 repo skeletons pass with no false refusals. The real `view.html` was driven against a mock API, and a pipeline-concurrency review was applied. **Owed:** an owner live save, conflict and restore on R2. **Still open:** the animation-library save is unconditional, two new rigs whose names differ only by case can both be created, and rig undo is a separate task. |
| 2026-09-28 | Runtime-release gates and served-hash check (§3.2, §5.1) | ✅ Merged + live | [PR #831](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/831), merge `881636a4`; docs in [#835](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/835). **`.svelte` coverage:** `check-undefined-names` now runs `svelte2tsx` over script and template. It caught both the #549 and #567 shapes on scratch copies, and one real bug was fixed (`InitialiseParent.svelte` used `PIXI` without importing it). **Release gates:** undefined-names, engine-game, rgs and the build all run before upload; any failure means nothing is published. **Served-hash check:** `verify-runtime-live.mjs` replaces the warn-only refresh. It polls until the served `index.html` names the new bundle and that bundle file returns 200, re-POSTs `/refresh` with backoff, and fails after 15 min. **Verified live:** run 36468901415 needed 201 s and 4 refreshes before the new bundle was served; the old step would have gone green too early. The live remake booted and spun with no errors. The rollback procedure is now documented in `engine.md`. **Still open:** versioned releases with a pointer flip; a failed build leaves "Releasing engine…" showing until the 30-min fallback; Lint is still not a required check. |
| 2026-09-28 | Flow editor safety guards (§4.3) | ✅ Merged + live | [PR #833](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/833), squash `375a916`, a runtime release; docs in [#837](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/837). **Seeding:** the scaffold seeds `flow-v2.json` with the starter flow, and Duplicate `setup` copies the source's flow. **Publish with no flow:** allowed, with a warning on the card; not seeded at publish. **Publish gate:** `checkFlowV2ForPublish` runs `validateFlowDoc` with the editor's own projection. Online Publish returns 409; only the admin role can "Publish anyway", and bulk republish skips invalid projects. The desktop `export-flow` also returns 409, overridable with `--allow-invalid-flow`. **Fan-out:** a new `exec-out-fanout` validator error, and the editor now replaces an exec-out wire instead of adding a second. **Bugs fixed:** fan-in issue keys; and `engineOwnedOnly` was dropping `repeater` nodes, so every scaffold lost its buy cards and all 5 starter flows failed validation. **Tests:** fan-out spike 8/8, `check:flow-publish-gate` covers all 5 types, the remake boots clean live, and `export-flow` returns 409 on test5 live. **Affected projects (audit of 11):** test4 (unfilled `betModeKey`), test5 (2 buy-card edge errors), bookofborut (retired), and salmons + hotfruits (no flow). The other 6 are valid, including the remake. Re-run with `scripts/audit-flow-v2.ts`. **Still open:** a flow saved invalid *after* publishing still reaches players, because the runtime reads live data (the §3.2 snapshot fixes this). There's no desktop UI for the override, library function bodies aren't validated, and custom kinds aren't covered. The Game Maker refusal dialog and the wire-replace UI are not live-verified. `test-engine-owned-only.mjs` is stale on main. |
| 2026-09-28 | Live free-spins check after #807/#810 (§5.1) | 🟡 Remake ✅ · test games broken, migration awaits owner | Docs [PR #836](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/836). Played on a real 60 fps headless clock. **bookofborutremake: PASS.** Intro holds until tapped, the book reveal and 10 spins play, the outro is a two-stage tap, and the balance is credited. **test4: BROKEN since #807** (seen live) — no intro or outro, nothing holds. **test2, test3, test5** have the same data shape (checked in R2). test2 also can't reach free spins: its symbol pool has no SCAT. **test6: DEGRADED** — no intro, and the outro flashes without holding. **Retired composer binds:** book_of_borut_redux, the remake (one harmless empty anchor), test2–5, unassigned/bookremake. **No flow:** book_of_borut_redux, cloud (published, but has no free-spin scenes), hotfruits, salmons, test7, bookremake. **No engine fix** (the #807 hard cut was owner-approved). **Owner decision:** approve the per-project R2 data migration for test2–test6 (bind the visuals + Tap to continue + Show→Show{awaitComplete}→Hide). **Also found:** the remake's Gold Rush card says $100 but the round debited $1; test6's Buy Feature button opens nothing. |
| 2026-09-28 | Secret scanning for the public repo (§2.1) | ✅ Merged | [PR #838](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/838), merge `3a266a1d`; scripts, CI and docs only. **Scanner:** `check-secrets.mjs` now also catches Anthropic, OpenAI (the hyphen bug is fixed), GitHub, RunPod, Cloudflare, AWS/R2 pairs, Slack, Discord, Google, Stripe, HF, npm, Civitai, PEM keys and credentialed DB URLs. It has `--diff` and `--history` modes, and its output never shows the value. Covered by 55 fixtures, with zero new false positives. **CI:** the new `secrets.yml` scans every PR's added lines and every push to main (check name `check-secrets`). The five "repo is private" statements and the `lint.yml` comment are corrected. **History scan:** all 3,573 commits across every branch and PR ref, with our scanner and gitleaks. **No real credential found**; the only hits were model checksums, one comment, and placeholders. The existing rotation list still stands, because those secrets were exposed outside git. **Owner settings:** secret scanning + push protection ON; a `main` ruleset (require PR, require `check-secrets`, block force-push/delete). Don't require Lint's `eslint` while it has `paths-ignore`. |
| 2026-09-28 | Three asset ship-chain gaps (§3.2, §4.3, §4.4) | ✅ Merged + live | [PR #839](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/839), merge `38283662`, including a runtime release. **Symbols:** `symbolExport` now reports `spinesMissing` instead of dropping them. It surfaces in the bake, the publish log, the boot warning and a new ⚠ note in the Game Maker (covering scene and symbol spines). **Sounds:** `sounds` is now in the pull prune list; the stale doc claim is fixed. **Boot splash:** the new `POST /api/editor/export-boot` is called from the bake, so desktop and delivery builds get the current `_boot/`. **Delivery gate:** `build-delivery.mjs` refuses a delivery with missing regions or spines unless `--allow-missing-assets` is passed. **Tests:** prune tested against a mock deploy; the delivery gate tested from a scratch repo; CI green; export-boot now returns 401 live. **⚠ The remake's next delivery will be refused:** its art index is missing `T_Button_Plus` and `T_Button_Plus_Pressed`. Re-pick or re-pack them, or pass the flag. **Still open:** no `--allow-missing-assets` toggle in the desktop launcher; a real bake and a real publish haven't exercised the new paths yet. |
| 2026-09-30 | **Every operator host setting honoured** (§5.3, Gate D) | ✅ Merged + live (runtime release `lines@057c1d524a51`) | [#885](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/885) (test server plays the operator), [#886](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/886) (engine behaviour), [#887](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/887) (verification record). **Rule:** no per-jurisdiction logic; each behaviour turns on only when the operator declares it, and absent means neutral. **Honoured:** min/max bet clamp on the ladder (read as credits; an empty ladder is refused); bet ranges and credit value; `denom`; `autoplayDisabled`; autoplay spins with loss and single-win limits (our definition); **`minSpinDuration`** on every spin, including free spins, turbo and slam; **`confirmGameRoundStart`** before every paid round, including autoplay; buy/high-chance RTP; currency symbol/format and locale; an operator strip with **home, clock, session time and history link** (authorable, hidden when the HUD binds its own). `maxWinMp`, `symbolsPay.scatter` and `maxWays` are cross-checked and warned about. Full table: `play4fun-protocol.md` § "Host settings — GameSettings.config". **Not read (reasoned):** `isLockChangeCurrency`, `betFactors`/`betPoints`, per-line/reel costs, branding/jackpot/country/demo. **Owed from the partner:** min/max bet units; the types of clock, showTime, elapsedTime, home, externalHistoryUrl and currencyFormat; the meaning of `errorPanel`; `historyClient`; `maxWinMp` entries beyond the first; whether they want our loss/win limit fields. **Mock:** manifest `hostSettings` and a token-gated `?host=` per launch. **Tests:** 10 field fixtures, `check:all` 298/298. Live remake with no fields is identical to the baseline; with fields: operator strip, €, the confirm question and ≥4.8 s spins at 3000 ms min. **Not re-run:** partner mode on the 2-complex node. **Note:** the remake authors 5,000× max win while the mock caps at 10,000×, so it warns once per boot. |
| 2026-09-30 | atlas-backend removed from the repo | ✅ Merged + live | [PR #883](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/883) (`0b6fd2ca`). **Removed:** `services/atlas-backend/`; the unused launcher getters (`ATLAS_BACKEND_URL`, `ATLAS_MANIFEST_KEY`, `ATLAS_STYLE_REF_KEY`); the ComfyUI client in `iw_common/comfy.py` that only atlas-backend used; and every mention (INFRA, rotate-a-secret, ONBOARDING, status and design docs, agents, the `/deploy` skill, CODEOWNERS, the PR template and the commit-scope list). **Kept:** `USER_AGENT`, `cf_headers` and `comfy_url` (used by atlas-tool), the rest of `iw_common`, and `history.md` (frozen archive). **Tests:** `check:all` 288/288 and all 6 CI checks. **Verified:** the Railway deploys succeeded, both tools' `/healthz` report `0b6fd2ca`, the launcher health returns 200, and the old URL returns 404. Infra open item #1 is closed. |
| 2026-09-30 | Rigger linked mesh in a non-default skin | ✅ Merged + live | [PR #884](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/884), merged as `b4ae8579` at 12:27Z once all 6 checks were green. The Railway deploy succeeded, and the live `/rigger/view.html` serves the new code (12:30Z). ＋ Linked mesh and the source picker now write `skin` unless it is `default`; an absent skin means the default skin, which caused "Parent mesh not found" or a silently wrong parent. The same rule is fixed in **rig import** (importing any Spine rig with linked meshes broke the open rig; S has 180), the source list and **skin rename**. Animation skin keys now move with a rename, and `default` can no longer be renamed. The review found a stale top-bar skin picker overwriting attachments (13 went blank on S), now fixed. **Tests:** the new `linkedmesh.mjs` spike (11/11 mutants caught); `rigmerge.mjs` now runs the shipped import; `check:all` passes 290/290. **Still open:** no browser check yet; follow-up chips for the stale skin picker (item 9) and for `irigDocProblem` not checking linked-mesh parents / animation skin keys (item 6). **Flaky:** `check-balance-flow.mjs` is time-seeded, which risks false reds in required CI. |
| 2026-09-30 | **Railway steps + Postgres public proxy** (§2.1, §7) | ✅ Owner done; proxy repaired | The owner completed the Railway steps (healthcheck, signing secrets). **The Postgres public TCP proxy had silently disappeared.** Only an HTTP domain was left pointing at port 5432, which can't carry Postgres, so local and backup connections timed out. Production was unaffected because it uses the private network. The owner added a new public TCP proxy. The coordinator confirmed Postgres answers the SSL handshake, updated the local `apps/launcher-api/.env` (a backup copy was kept), and a real login succeeded (`select 1` on `railway`). **Owner:** make sure `DATABASE_PUBLIC_URL` uses `RAILWAY_TCP_PROXY_DOMAIN`/`PORT`, and use this host:port for `BACKUP_DATABASE_URL`. |
| 2026-10-01 | Atlas/Flipbook follow-ups: RunPod cancel endpoint + Sheet presence | ✅ Merged + live | [PR #949](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/949) (`cf27e103`); both `/healthz` report it. **Endpoint per job:** `runpod_submit` returns job id + endpoint; video variations store `job_endpoint`; status, cancel, re-attach, adopt and orphan Stop/delete use it. Atlas render markers carry it, so UI Stop cancels on the right endpoint. Legacy records fall back to the env and log a line. Mocked tests, no paid jobs; flipbook item 2 closed. Caveat: the serverless worker reads its own `RUNPOD_ENDPOINT_ID` from the endpoint env, so a new endpoint needs it set. **Sheet presence:** "👤 X is editing this sheet", sharing `iw_common/presence.py` and `presence.js` with Atlas (no copy) and identified by the signed launch token. `test_presence.py` 32 checks (unsigned or forged → 403); sheet item 5 closed. `check-python` 45/45 (SemanticLayers tests marked `requires torch`). **Owed:** a live two-browser run and a real endpoint-rotation test. |
| 2026-10-01 | Flaky required `python tests`: sheet `test_doc_conflicts.py` mutant control | ✅ Merged [PR #948](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/948) (`38f03cd6`, all 8 checks passed; no deploy or release) | **Cause (reproduced):** the threads only overlapped through a 0.2 s fake-R2 delay; on a slow runner the second thread saw the new ETag and was refused before composing. **Fix:** in sheet-tool, an `Overlap` rendezvous after `_check_base` plus a `ContendedLock` that reports the wait, all waits bounded at 10 s; the lock run now also asserts contention happened. In atlas-tool the existing barrier now names a writer that errors or never finishes. **Proof:** sheet 200/200 under load; atlas 200/200; stripping the lock still fails the real checks; `check:all` 324/324. Tests only, nothing deploys. Background: the owner spotted it. "(mutant) without the lock both compose — got 1, want 2": the control removes the lock and expects both threads to compose, but nothing forces the threads to overlap. It's a test-only race; the real lock test passes. Card "Fix flaky race test in sheet/atlas test_doc_conflicts": force the overlap with a Barrier and a timeout in both the sheet and atlas twins and any timing-based race test, prove it with a 200× loop, and keep the real mutant failing. |
| 2026-10-01 | Launcher: self-service password change | ✅ Merged + live | [PR #944](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/944) (`f2cbf914`); deploy succeeded, and `/account/password` returns 303 to /login when signed out. **Shipped:** a header link to `/account/password`. The current password goes through the login throttle and `verifyCredentials` with one uniform error, and a lockout returns 429. The new password must be 12+ characters and differ from the current one and the email. It is re-hashed with scrypt, and **every other session is revoked** while the current one is kept. Admin create/reset also require 12 now (was 8); existing passwords still log in. **Tests:** `check:change-password` 51 checks in the Lint gates, 14/14 mutants caught; `check:all` 324/324. **Owed:** a live change from two browsers. |
| 2026-10-01 | Dependabot #929 taken as #936 · release verifier false red | ✅ Done — #936 + #941 merged, release green, verified live | **Final:** #936 = the npm group (#929) + TypeScript 5.9.3 (#915). Fixes: stale svelte-ignores; pixi 8.21 `readonly Filter[]`; TS 5.9's launcher Response-bytes errors fixed once at `getObjectBytes` (no cast); svelte-check baselines lowered (storybook 8→7, engine-layout 296→291, lines 166→165); the tsx ≥4.20 hook for slamcounter; rigger item 14 (esbuild resolved via a helper). **Found and fixed: `<Cinematic>` read a nonexistent `appContext.app.ticker`, so EVERY in-game cinematic threw on mount since 2026-08-17**, hidden in the svelte-check baseline. **autoUpdate verdict:** CinematicActor is unaffected (4.2.120 made the setter idempotent; asserted in cinematic-pixi part C with mutants). **Browser proof:** a two-rig cinematic at ×1 in 6.00 s and ×2 in 3.00 s, 0 double spine updates in ~200k, MEGA WIN plus bought free spins, 0 errors; `check:all` 321/321. A dispatched release went green ("LIVE after 10s … lines@954180328cc6"), #940 is closed, and the live play-through passed. **Still open:** runtime source maps no longer reach Sentry (SvelteKit 2.70 deletes the map; needs a config-vite hook before Sentry goes live — infra item 7); mounting a cinematic hitches the game clock ~1–2 s, probably the first texture upload (cinematic item 7); #915 was closed by hand while Dependabot had already retargeted it to TS 6.0.3, which may now be skipped — needs a human look. | [#936](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/936) merged (`e81c0c21`); live remake verified on `lines@e81c0c21ce3f` (boot, spins, a full 10/10 free-spin round, the injected cinematic, 0 errors). **Side effect:** SvelteKit 2.70 now inlines the bundle into `index.html` and deletes `bundle.<hash>.js`, so the served-hash verifier's HEAD got a 404 and the release runs for #936/#938/#939 went red (issue #940). The builds were promoted and serve correctly — no outage, no rollback needed. **Fix [#941](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/941)** (`95418032`): only HEAD the file when the page loads it by `<script src>`. Next: one dispatched release to prove it green, close #940, full report. |
| 2026-10-01 | ~~LIVE REGRESSION: free spins stall after a free-spin `setWin`~~ → **FALSE ALARM** | ✅ No bug | **Resolution:** this is `holdAfterBigWin` (`apps/lines/src/game/freeSpinHold.ts`) working as designed. The remake's symbols doc sets `winCycle.holdAfterBigWin: true`, so after a big win the round parks on the board until SPIN is pressed. The harness only tapped the board; with Spin presses SEED=2 completes 10/10 → outro → base with 0 errors. The H&W hub can unfreeze. **Product question for the owner:** should free spins hold on a big win waiting for SPIN? An authoring choice. Original report: | Found by the #936 deps session. A free-spin round stalls for good when a free spin's win reaches `setWin` (the tap-held win overlay `s_2zj4z49e`): HOLD → tap → RELEASE → `cue winHide`, then nothing; the counter stays at "1 OF 10" with no console errors, even though all 10 plays + collect were already fetched. Rounds with only `winInfo` wins complete. **Deterministic** on origin/main `28b09d57` with the OLD deps (mock SEED=2, BIG_WIN=1, buy, real-clock), so it is **not caused by #936**. Live `lines@515e6690` is very likely affected. **Suspect:** the Hold and Win mode-stack PRs #930/#933/#931/#934; bisect in progress. The H&W hub acknowledged and froze its runtime merges (#938/#939 held). **New lead from H&W:** during Phase 4a (#928, *before* the mode-stack PRs) they saw "after a big-win overlay is tapped away the round waits for a Spin press — the published runtime does the same". So the "stall" may pre-date #930/#933, and may be the authored `winCycle.holdAfterBigWin` spin-hold waiting for a Spin press rather than a hang. Context sent to the bisecting session. **Options:** a fix, or the "Runtime rollback" workflow to a pre-regression release (owner's call). |
| 2026-10-01 | **Rigger undo/redo** (item 1) | ✅ Merged + live | [PR #937](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/937) (`dfcd87c3`), rebased on #935; live `view.html` byte-matches main. **Feature:** snapshot history of `rawDoc` plus selection, skin on stage and open clip; ↶ ↷ buttons, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. **One step each:** a user action, a drag, a typing burst (≤800 ms), a delete cascade (including the compensated bone delete), convert to mesh, import, auto-weights, 🩹 Repair. Works in Preview, Setup, Animate and Tweak; the plain Cinematic stage keeps its own history. Undo never saves but marks the rig unsaved; opening a rig or a failed open clears the history. Capped at 100 steps / 64 MB (mm_bigwin: 1.07 MB and ~5–7 ms per step). **Side fixes:** the bounds write no longer leaks into the next undo step; `cinematic.js` no longer throws every frame while booting; library import no longer asks to confirm, since it can be undone. **Tests:** `rig-undo.mjs` drives the real page, 89/89, with 12/12 mutants caught; `check:all` 320/320. |
| 2026-10-01 | Rigger: Auto FX sequence guard + steady bone delete (item 8) | ✅ Merged + live | [PR #935](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/935) (`9dfc2433`, after all 8 checks passed; live ~3.5 min later). **Auto FX:** on a slot showing a sequence it used to repoint the sequence `path`, so the rig no longer opened. It now skips that layer and says why, since a Spine sequence can't name per-frame `_glow` regions, and `repointSlotSetupImage` refuses sequences (sequence.mjs §F on W). **Bone delete:** children, slots and weighted vertices keep their setup-pose world position (uses the drawn pose including constraints; all 5 inherit modes; weights merged into the parent). Exceptions: a bone at scale 0, and an image under shear keeps only its centre and area. **Tests:** `delete.mjs` checks every bone delete to 1e-3 on anticipation, W and S (W and S newly in CI) plus a synthetic rig; the old code fails; 19 mutants caught; 153/153 rigs; `check:all` 313/313. |
| 2026-10-01 | Flaky "no devtools endpoint" in required check-all | ✅ Merged | [PR #921](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/921) (`cbe7da82`). **Measured root cause:** a fresh runner reads Chrome's 435 MB install slowly the first time (3.3–7.9 s cold). The first launch in a shard waited 4–40 s, and the hand-copied launchers gave up at 20 s; concurrent first launches failed in pairs. **Fix:** a single `tools/rigger-spike/chrome.mjs` (pipe transport, fresh profile, **launch-only** retry 3× 45 s, a timeout on every call, guaranteed cleanup) used by all 5 browser spikes; check:all runs browser spikes one at a time and always prints `[chrome] ready in … (attempt n of 3)`; checks.yml pre-reads Chrome during install. **Proof:** 150 local + 420 CI loops with 0 failures and 0 retries; 12/12 shards green; planted failures still fail (a flipped assertion with no retry, a hung page on its timeout, a silent Chrome in bounded time, a crash in under 1 s); 0 orphan processes. `check:all` 307/307. CI only. |
| 2026-10-01 | **⚠ Dependabot #911 bumps Spine 4.2.74 → 4.3.13** | ✅ Pinned in [#927](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/927) (`304253f8`) · #911 closed → replaced by #929 (still red) | **#927:** `dependabot.yml` ignores minor and major updates for `@esotericsoftware/*`, so only 4.2.x patches come through. `tools/rigger-spike/spine.mjs` is the single resolver all 48 spikes use, and exits 1 with a clear message off 4.2.x. `scripts/check-spine-version.mjs` in check:all checks every package.json spec (4.2.x / ~4.2.x; `^` refused) and every lockfile entry (both mutant-proven). `check:all` 310/310. Dependabot closed #911 itself and opened **#929** (34 updates; Spine is now only 4.2.74 → 4.2.120). **#929 is still red:** two unused `svelte-ignore` comments after the svelte bump (eslint); a pixi.js 8.21 type change in `cameraEffects.ts:178` (+ maybe `LayoutNodeView`/`InfoOverlay`); `flow-spike:slamcounter` fails with `.svelte` ERR_UNKNOWN_FILE_EXTENSION (tsx?); **`cinematic-pixi.mjs`: spine-pixi-v8 4.2.120 changed the `autoUpdate` setter — check `<CinematicActor>`'s assumption before taking the patch**. New rigger item 14: seven spikes hard-code `esbuild@0.25.5`. Background: the owner spotted the CI failure: every rigger spike fails with `spine-core@4.2.74 not found`, because #911 (the "npm-minor-patch" group) bumps `@esotericsoftware/spine-pixi-v8` to 4.3.13. Semver calls it a minor, but **for Spine 4.2 → 4.3 is a data-format boundary**: every exported rig and the Rigger's `.irig` are 4.2. `main` is unaffected (green). Only the spikes' hard-coded 4.2.74 path caught it. **Task queued, "Pin Spine to 4.2 in Dependabot and the spikes":** ignore minor and major updates for `@esotericsoftware/*` in `dependabot.yml`; spikes resolve spine-core through one helper that asserts 4.2.x; a check:all guard on every package.json; `@dependabot recreate` #911. |
| 2026-10-01 | Dependabot #918 (pip) + #903 (actions) merged by the coordinator on owner OK | ✅ Merged + verified | #918 (`5dd29d3e`): Pillow 10→12, boto3, PyYAML, sentry-sdk. Atlas and sheet redeployed and `/healthz` is ok on `5dd29d3edab4`. #903 (`1266d4b5`): checkout/setup-node/setup-python v7, pnpm v6, docker v4/v7 — all 6 required checks and svelte-check were green on the PR. On main: Checks, Secrets and **both ComfyUI image builds** (R&D pod + worker) succeeded. A dispatched **Nightly backup** on the new actions passed (restore check 17/17, 3 uploads verified). The runtime release/rollback workflows will first exercise the new actions on the next engine merge. **Held back:** #911 (npm group: +13/+21 type errors) and #915 (typescript 5.9: +6); #913 needs `@dependabot rebase`. |
| 2026-10-01 | svelte-check ratchet + Dependabot (§7.4) | ✅ Merged, green on main | [#901](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/901) + [#916](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/916). **Jobs:** `svelte-check (1/2)` and `(2/2)`, ~2 min each, **not required yet**. **Baseline:** 1,165 errors across 17 packages (lines 166, launcher 53, engine-layout 296, …), confirmed on Linux CI; the vendored `libktx.js` is excluded. Regenerate with `pnpm check:svelte --update`. **Dependabot:** config for npm, pip and actions, weekly and grouped. The first run opened 11 PRs: #903 actions; #911 npm grouped (34 updates); #912–#915 (3 majors + typescript); #904–#908 pip (grouping fixed in #916). **⚠ Merging any npm Dependabot PR touches `packages/**` and fires a runtime release.** **Owner:** (1) GitHub → Advanced Security → turn on Dependabot alerts, security updates and grouped updates; (2) later, add both svelte-check jobs to the ruleset. **Flakes (follow-up tasks queued):** the Rigger headless-Chrome spikes fail with "no devtools endpoint" — hit the **required** check-all 3× today, including on main; the "No Lingui config found" style error in `components-shared` is filtered, root cause unknown. **Follow-up:** the red on main (#909, #910) was only that flake (7 extra `svelte(style)` errors, hitting 1 in 3 Linux runs). `withoutFlakyErrors` (#916) drops exactly that rule and message; main has been green since `3cf3cbd8`. Mutation-proven in `components-shared`: TS errors and a new scss error still fail it. Gap: while the flake fires, those 7 files' scss goes unchecked. **The ratchet is already catching real regressions on Dependabot PRs — do NOT merge as-is: #911** (npm group: +13 errors in `apps/lines`, +21 in `apps/cluster`) **and #915** (typescript 5.9: +6 in the launcher). #913 is stale red and needs `@dependabot rebase`. The pip grouping worked: #904–#908 were closed and replaced by grouped #918 (green). |
| 2026-10-01 | Atlas/Sheet conflict-safe saves (concurrency Phase 3b, §4.1) | ✅ Merged + live (owner instruction) | [PR #910](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/910), merged as `be3e4bc2`; atlas-tool and sheet-tool `/healthz` both report `be3e4bc223d2`. **Atlas:** every manifest, `atlas_config` and region save goes through `doc_sync.py` with CAS (If-Match on the version the page loaded) and a `saved_by` stamp from the signed launch identity. Render-pipeline writes are CAS-only and rebased onto the winner, so they never trip an author and never drop work. Creates are If-None-Match. **Sheet:** Save, Save As, rename, `.plist` import and unlock are CAS'd, with new names create-only. **Soft lease:** a "👤 X is editing this atlas" banner (Sheet: next). **Conflict dialog:** "Alice saved … at 14:02" → Reload theirs / Overwrite with mine (If-Match on the version shown) / Cancel. **Tests:** atlas 114, sheet 101 (races, pipeline merge, 6 must-fixes each mutant-pinned). **Blocked:** the permission classifier refused `gh pr merge` because the non-required `svelte-check (2/2)` is red — it is red identically on main (#901, "No Lingui config found" in `components-shared`) and this PR touches no Svelte. **Owed:** a two-browser live run. |
| 2026-10-01 | BiRefNet/RMBG pre-fetch + orphaned RunPod jobs (§4.2 Flipbook) | ✅ Merged · **owner: pod fetch + endpoint pin + 1 render** | [PR #909](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/909) (`022c0e6a`). **Root cause:** ComfyUI-RMBG rewrites `birefnet.py` in place on every load, and every worker wrote the one shared `models/RMBG/` file — which is why the 09-04 outage lasted 14 h. **Fix:** `fetch-models.py` gains commit-pinned, sha256-verified `rmbg` and `birefnet` sets, baked into the worker image. Workers stage the verified files into the container instead of linking the volume, and fall back to a per-container download, so rollout order doesn't matter. `provision.sh` pins RMBG. **Orphaned jobs:** a 404 on a job already read is re-checked at +10/+30/+70/+150 s, then cancelled and logged; adopt, delete, re-attach failure and the 30-min still cap also cancel. **Tests:** 6/6 checks; images built; `check:all` 303/303; no paid job run. **Owner:** (1) on an R&D pod, `python /fetch-models.py --set rmbg --set birefnet` then `--verify`; (2) pin the serverless endpoint to `ghcr.io/invisible-wall-sl/atlas-comfy-worker:022c0e6a3c98`; (3) one cheap render with the default cutout — the boot log should show `verified 20 file(s)`. **Still open:** a cancel after an endpoint-id rotation goes to the new endpoint (store the endpoint per variation). **⚠ `svelte-check (2/2)` (#901) is red on main** (new `svelte(style)` errors in `components-shared`; not required). |
| 2026-09-30 | Sentry source maps (§7.3) | ✅ Merged + live · **dormant until owner token** | [PR #902](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/902) (`5630e57b`). **Runtime:** hidden maps (`IE_SOURCEMAPS=hidden`); `scripts/sentry-sourcemaps.mjs` re-bases the map onto the inlined `index.html` (the bundle starts at line 128, col 5), injects a debug-ID snippet, uploads page + map with sentry-cli for release `<sha12>`, then deletes every `.map`. `publish-runtime-bundle.mjs` refuses to publish any `.map`. **Launcher:** the same on Railway when `SENTRY_AUTH_TOKEN` is set (92 maps in the dry run). A missing token or a failed upload never fails a release; only a leftover map does. **Verified:** fixture with mutants; `--dry-run` against a stand-in; a real browser frame resolved to its call site; release `5630e57b16eb` green; R2 holds 0 `.map` and 0 `sourceMappingURL`; the live page's `.map` returns 404. **Owner:** (1) a Sentry org token (`org:ci`, EU); (2) GitHub secret `SENTRY_AUTH_TOKEN` + variables `SENTRY_ORG`, `SENTRY_PROJECT=game-runtime`; (3) Railway launcher `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT=launcher`; (4) run Runtime release and look for "Uploaded source maps"; (5) console test `setTimeout(() => { throw new Error('sourcemap check') })`. Steps in INFRA.md § "Readable stack traces — source maps". |
| 2026-09-30 | Rigger mesh UVs on trimmed + sequence images (items 12 + 10) | ✅ Merged + live | [PR #898](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/898) (`88605c57`); live ~3.5 min later. **Root causes:** mesh `uvs` are fractions of the **untrimmed** image (spine-core adds back offsets and undoes rotated packs), but Convert/Draw laid them across the trimmed ink quad; for sequences, Convert/Draw/Linked mesh copied only `path` (the frames' stem, which no region has) and dropped `sequence`. **Fix:** UVs mapped through the ink's place (`regionInkUVs`), so the mesh draws exactly the region's pixels; `sequence` carried everywhere (the linked-mesh picker too); frames trimmed differently (41/44 sequences) get a covering mesh after a prompt; the UV panel shows the untrimmed image for all 4 rotations. **Repair:** a banner on open offers 🩹 Repair or "keep as is" for safely detectable cases, with 0 false positives on 1,615 meshes. Uneven or evenly trimmed scaled images aren't detectable; the manual redo is in the guide. **Tests:** `trimmesh.mjs` 515 checks with **pixel comparison through the real WebGL runtime** (the old page fails 155; 20/20 mutants caught); `check:all` green. **Found, not fixed:** item 13 — **spine-core 4.2 itself draws a REGION on a 180° pack upside down and on a 270° pack transposed**, affecting only `apps/price/…/symbolsSpecial` (18 regions); re-pack without 180/270. ✨ Auto FX `repointSlotSetupImage` has no sequence guard (chip filed). The idle older session "Fix Rigger meshes made from trimmed or sequence images" is superseded and can be archived. |
| 2026-09-30 | Rigger save + index data-loss gaps (items 6 + 2) | ✅ Merged + live | [PR #897](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/897) (`a7c75f09`), launcher only, live and byte-identical. **6a:** the animation library is create-only / If-Match through the shared `riggerLibraryWrite.putLibraryEntry`; nothing is written on a 409. **6b:** a new rig or upload whose name differs only by case is refused with 409 and the claim released (race-proven). **6c:** `irigDocProblem` now covers skin bone/constraint lists, constraint keys, draw-order slots and event names; 181/181 with 0 false refusals on 153 rigs; 1,529-rename differential vs spine-core. **Item 2:** every reindex path goes through `reindexProjectSkeletons`, so an atlas-less rig is never dropped and deletes aren't undone; `buildSkeletonsIndex` removed. `check:all` 303/303. **Addendum [#899](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/899) (`606fc1ee`, live):** an abandoned create claim (unlisted, atlas-less, only `<folder>.irig` + pages, idle more than 10 min) is reclaimed before the name check: backed up to 🕘, taken over with If-Match on the listing's ETag, then deleted. `check:rigger-writes` 51/51 (15 fail on the old code); every guard is mutant-checked; `check:all` 304/304. Residual: a create stalled more than 10 min after its claim could be reclaimed. **⚠ New flake:** `skins-panel.mjs` (from #896) failed once in required CI with "no devtools endpoint", a Chromium launch timeout; green on re-run. |
| 2026-09-30 | Rigger item 9 closed — option A | ✅ Merged + live | [PR #896](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/896) (`ef3acc55`, on top of #894/#895, after all 6 checks passed). **＋ add image… in a non-default skin** becomes that skin's own image under the slot's setup name; the setup attachment is unchanged, so every other skin draws exactly as before. Default: unchanged. A slot with no setup attachment gets the region name (or name2…), and default still draws nothing there. If the skin already has its own image: a plain region is replaced in place; a mesh or sequence is refused with a pointer to "replace image (keep mesh)…". **Deleting the default skin is refused.** **Tests:** `skins-panel.mjs` in real Chromium 71/71 (the old page fails 27); `linkedmesh.mjs` on every CI rig slot (the old page fails 236 on anticipation and 195 on S); `check:all` 302/302. Live ~3.5 min after merge, byte-identical. Docs, including a Traps entry, updated. |
| 2026-09-30 | Rigger follow-ups (sessions started by the owner; no reports to the coordinator) | 🟡 2 merged, 2 open | Merged: [#892](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/892) — **a rig that fails to open leaves no rig open, so 💾 can no longer write one rig over another** (the data-loss item); [#893](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/893) — ▸ Convert to mesh / ✎ Draw mesh edit the image on stage. **[#894](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/894) merged** (`a328abe8`, after all 6 checks passed): the placement fields, the pivot and replace image now edit the image on stage, resolved through #893's `rawDocAttSkin`/`rawDocAttEntry`. Before, an overriding skin's edit snapped back at the next rebuild. Tests: `linkedmesh.mjs` 797 / 7288 / 4921 checks (the old page fails 67 / 823 / 475), 9 mutants caught, `check:all` 302/302. The deploy was still in progress when reported. Open: [#895](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/895) (stage errors no longer hidden under the mode bar). **Rigger open items still on main:** undo (1); index rebuilds can drop an atlas-less rig (2); auto-weights quality (3); text rename, mesh text fit, persistent FX slots (4); 3.6d (5); save residuals — the animation-library save is unconditional, case-only name clashes, gaps in the server check (6); spike reds on other rigs (7); bone delete uncompensated (8); **＋ add image… in a non-default skin** (9) — **owner chose A (2026-09-30): the new image belongs only to the active skin**, and default is unchanged; task queued with the default-skin delete guard; linked mesh / convert on a **sequence** mesh loses `sequence` (10); **a mesh from a trimmed image is UV-mapped wrong** (12). |
| 2026-09-30 | **Nightly backups LIVE** (§7.2) | ✅ Owner setup done, verified | **Environment:** `backups` is locked to `main` with 5 environment secrets and `BACKUP_AGE_RECIPIENTS` (2 keys); none leaked to repository secrets. **First real run** (dispatched by the coordinator, [run 36732132416](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/36732132416)) **succeeded**: the Postgres dump plus a restore check (17 tables, row counts identical); uploads of `postgres/…tar.age` (60.3 KB), `r2-docs/…tar.gz.age` (5.4 MB) and `r2-assets/…tar.age` (3.3 GB), each size-verified. It now runs nightly at 02:37 UTC. **Owed within a week:** restore drill A with the owner's real age key (`docs/guides/backups.md`). |
| 2026-09-30 | Rigger save validates linked meshes + skin keys (rigger item 6) | ✅ Merged + live | [PR #891](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/891), merged as `cae4d719` at 14:18Z after all 6 checks passed. Railway was live at 14:23Z; `view.html` is byte-identical to the merge. Launcher only. **Server check:** `irigDocProblem` now resolves linked-mesh parents (by Spine's skin rules) and animation `attachments` keys (skin, slot, and the attachment for deform/sequence keys). **Library save:** 📦 Save rig to library runs the full parse first. **Found in review and fixed:** Apply saved rig refuses a library rig that won't load; Import into open rig merges on copies and refuses rather than breaking the open rig; and import now **carries the imported rig's `events`** — dropping them broke every rig with FX/flipbook bindings. **Tests:** `irig-save.mjs` 83/83 (153 rigs; the old code fails 25; 19 mutants caught), two differential fuzzers vs spine-core with 0 false accepts, the real `view.html` in a browser, `check:all` 300/300. **Still open:** the server doesn't check skin bone/constraint lists or constraint, draw-order and event keys (the client parse catches them). **⚠ New item 11, data loss:** after a rig fails to open, 💾 Save writes the *previously open* rig over the one that failed (reproduced, not fixed; chip offered). |
| 2026-09-30 | **Owner setups — coordinator verification** | 🟡 Mostly verified | ✅ The `PUBLIC_SENTRY_DSN` repo secret exists; runtime release `workflow_dispatch` 13:15Z was green; the live remake page (inlined bundle, `lines@713d19bfe4ab`) **contains the Sentry SDK and the EU ingest (`ingest.de.sentry.io`)**. ✅ `/api/health` returns 200 with db ok and schema current; games `/healthz` ok with `lastHydrate.succeeded`; atlas-tool and sheet-tool `/healthz` ok at `713d19bf`; HSTS, `nosniff` and `X-Frame-Options` live. ❌ **Backups not configured:** the `backups` environment has **no secrets, no variables and no branch policy**, and the last nightly run logged "not configured yet (no BACKUP_DATABASE_URL)". Not visible from here: the launcher/tools Sentry env vars, the Railway healthcheck, the signing secrets taking effect, `gamePublish`, Better Stack, RunPod. |
| 2026-09-30 | Rigger skin picker kept in sync (rigger item 9, part 1) | ✅ Merged + live | [PR #890](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/890), merged as `cad7c8a9` at 14:03Z after all 6 checks passed. The Railway deploy was live at 14:07Z; live `view.html` is byte-identical to `cad7c8a9`. Launcher only, no runtime release. The bottom-bar Skin picker re-renders from `skeletonData.skins`, and every edit reads `activeSkinName()` (the skin on stage), never the picker. A rebuild or rename keeps the skin on stage, and ＋ add image… inherits placement. #884's shim is removed. **Tests:** `linkedmesh.mjs` runs the shipped code (217 / 593 / 914 checks, 11 mutants caught); the new `skins-panel.mjs` drives the real `view.html` in headless Chromium, 36/36, while the old page fails 22/36. The review re-armed a vacuous `sequence.mjs`. `check:all` 301/301. **Still open (item 9, chips filed):** ＋ add image… in a non-default skin repoints the slot's setup attachment and blanks it in default (**owner decision**); ⬡ Convert / ✎ Draw mesh rewrite default's same-named image; deleting the default skin is still allowed. Owner live check owed. |
| 2026-09-30 | Flaky `check-balance-flow` (required CI) | ✅ Merged | [PR #889](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/889), merged as `24adfb32` after all 6 required checks passed (each check-all shard 91/91). Repo auto-merge is disabled, so it was merged by hand. **The check was wrong; the facade was right.** It read a round's FIRST `setTotalWin`, but a free-spin round sends a running total per spin. The mock is clock-seeded, so it failed ~1 run in 10 (30/300 seeds, all free-spin rounds). **Fix:** read the LAST `setTotalWin`; anchor the interim to the starting wallet minus stakes (the old delta was near-tautological); force a free-spin round on every run; `check-all` seeds each private mock by check id. **Tests:** 0/300 seeds fail; 2/2 mutations caught; `check:all` 300/300. Scripts only, no runtime release. |
| 2026-09-30 | Stale "Make CI checks" card (woke late) | ✅ Docs only | It found the work already shipped in #881. It verified the checks on #882, #886, #887, #888 and main, then merged [#888](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/888) (`713d19bf`), which removes the owner-blocker lines from STATUS and infra status and marks the INFRA ruleset section as applied. That section keeps the `gh api` command for rebuilding the ruleset. |
| 2026-09-30 | **GitHub security settings** (§2.1, §7.4) | ✅ Owner, verified via API | The repo stays **public**. **Secret scanning** and **push protection**: enabled. **Ruleset `main` (24185070)**: active on the default branch, no bypass; blocks deletion and force-push; requires a PR; requires `check-secrets`, `check-all (1/3)`, `check-all (2/3)`, `check-all (3/3)`, `python tests` and `eslint`. **Org 2FA**: required. **Still off (optional):** Dependabot security updates, non-provider-pattern scanning, validity checks. |
| 2026-09-30 | **`atlas-backend` deleted** (§2.1) | ✅ Owner, verified | The owner deleted the Railway service. Coordinator check: `/health`, `/docs` and `/comfy/stats` all return Railway's **404 "Application not found"**. §2.1 is closed. No CF Access rotation is needed (owner decision). **Follow-up (docs only):** `services/atlas-backend/` source, the `watch paths` rows in INFRA, and the "legacy atlas-backend" lines in `rotate-a-secret.md`/INFRA can now be removed. |
| 2026-09-30 | CI jobs always report, so they can be required (§7.4) | ✅ Merged · owner adds 5 names to the ruleset | [PR #881](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/881) (`0b5e1168`). Checks and Lint no longer use `paths-ignore`. A composite action, `.github/actions/code-changed`, skips every later step when only docs, `.claude` or `*.md` changed; the job then passes in about 10 s with no install. If the diff can't be worked out, everything runs. Job and matrix names are unchanged. **Proof:** on docs-only PR #882 all 6 names reported in 8–11 s; on #881 everything ran for real (261 checks, 44 Python tests, 17 eslint steps). **Required names:** `check-all (1/3)`, `check-all (2/3)`, `check-all (3/3)`, `python tests`, `eslint`, `check-secrets`. The exact ruleset and a one-call `gh api` command are in INFRA.md § "Branch ruleset on `main`". **The existing ruleset 24185070 already has** delete/force-push protection, PR required and `check-secrets`, so **the owner adds only the other 5 names.** |
| 2026-09-30 | Rigger delete cascade (rigger item 7) | ✅ Merged + live | [PR #880](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/880) (`c7acb61a`); `/rigger` live at `v=c7acb61a2299` with no console errors. **The reported l3 red was the spike's hand-copied `deleteBone` drifting from the code.** Running the shipped code over all 153 rigs found the real breaks. **Slot:** deleting a path constraint's target **slot** caused a 422 on save; this hits 72/153 rigs across every app. **Bone:** a delete remapped only mesh weights — W's clip jumped 655 px, and deform keys desynced. **Slot:** a delete left holes in the animated draw order, which crashes the renderer. **Linked mesh:** deleting its parent broke loading (S: 180 linked meshes). **Constraints:** a gap in `order` meant a later constraint silently stopped running (h1). Skin lists were latent. **Fix:** one `dropConstraints()` used by every delete path, with a notice to the author; weighted path/box/clip indices and deform keys remapped; orphaned linked meshes become plain meshes; draw-order keys rebuilt. **Proof:** the new `delete.mjs` spike uses the shipped functions — it fails 31 checks on the old code, passes 153/153 rigs, and catches 5/5 mutants; `check:all` passes 288/288. **Still open:** rigger item 8 (a bone delete doesn't compensate child transforms); `addLinkedMesh` omits `skin` for a non-default skin (the separate "Fix Rigger linked mesh" session). |
| 2026-09-30 | All test harnesses in CI (§5.4, §7.4) | ✅ Merged, all workflows green on main | [PR #877](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/877) (`40be94bf`). **New `Checks` workflow** (PRs + main; docs-only skipped). **`check-all` (3 shards):** 261 checks, auto-discovered — 37 package fixtures, 35 launcher checks, 35 root scripts including mock-RGS smokes, 55 flow-spike, 59 rigger-spike, 14 fx, 12 flipbook, 7 game-config and more. `--exclude-lint` avoids running Lint's 27 checks twice. **`python tests`:** 44 checks (atlas-tool, sheet-tool, atlas-serverless, SemanticLayers on CPU, backup `--help`), no secrets. **Fixed:** all 6 red flow-spikes are green, including 1 real bug in `engine-flow-migrate/translate.ts` (offline only); `test-engine-owned-only` is green; stale guards and spikes updated; `check-balance-flow` now fails on a mismatch; a CRLF false red is fixed; rigger brush/weights spike model corrected; the ComfyUI ping is stubbed. **Deleted:** the print-only `check-board-dim` and `check-win-amounts`, and the stale `v2translateremake`. **Still open:** the svelte-check ratchet (svelte-check isn't a dependency; infra #7); **probable real Rigger bug** — deleting a bone on `symbols/l3` leaves a dangling path constraint (rigger #7). **To require:** `check-all (1/3)`, `(2/3)`, `(3/3)`, `python tests` and `eslint`. They need a docs-only no-op job with the same names before they can be required (infra #6). |
| 2026-09-30 | Desktop launcher: relay publish, provenance, Optimize, refusals (§3.2) | ✅ Both merged · **v1.0.56 released** · owner Publish/Deliver test owed | Engine [#866](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/866) (`b4ae132b`); launcher [invisible-launcher#14](https://github.com/Invisible-Wall-SL/invisible-launcher/pull/14) merged as `1693524`, and **v1.0.56 is released**: `/api/launcher/latest` reports 1.0.56 (39.5 MB) and the served exe's sha256 matches the manifest. Installed launchers offer the update on their next check. **R2 rotation is safe for publishing once each publishing desktop is on 1.0.56.** **Relay:** ☁ Publish goes through `api/launcher/game-upload` as the signed-in `gamePublish` user, with no R2 credentials. Direct R2 is an owner opt-in that falls back to the relay. The relay skips unchanged files by MD5, refuses oversized files up front, and runs 4 parallel uploads. Real bundles are 87–140 MB with a largest file of 6.2 MB, so presigning wasn't needed (it would also have hit the Spanish ISP block). **Provenance:** build number, builtAt, engine SHA, game SHA, lockfile sha256 and launcher version, written to `build-info.json`, `window.__IE_BUILD__`, EMBED.md §5 and the delivery `--json`. **Optimize:** WebPs are never re-encoded (the old q80 moved pixels by up to 108/255); PNG pages go to near-lossless 40 (max error 4/255, alpha exact); checked visually. Test1 went 390 → 196 MB. **Refusals:** invalid-flow, paytable-drift and missing-assets are emitted as data, and the launcher shows a "Build refused" dialog with an acknowledged override. **Docs:** launcher README and `docs/guides/publisher-runbook.md`. **Tests:** fixtures (route 47, provenance/refusal 28, optimize 12, build-provenance 23, relay 39) and real `lines`/embed/delivery builds. **Owner:** run a real ☁ Publish + 📦 Deliver of Test1 signed in. The session then merges #14 and releases 1.0.56. **R2 rotation is safe once 1.0.56 is installed.** After rotating, only the owner's machine needs the new key (models/nodes/tunnel, Seed Atlas, `build_and_publish.py`). |
| 2026-09-29/30 | Follow-ups raised by the runbooks session (started by the owner; no reports to the coordinator) | ✅ mostly merged | From the session list: [#869](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/869) unsaved-work guards for Config, Win Text and Localization; [#870](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/870) the test-server mock follows the **published** config (the author channel is `/api/<key>/authoring`); [#875](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/875) the admin hint no longer claims `games` is behind Cloudflare. "Add leave warnings to FX, Flipbook and Symbols" is idle with **no PR**, status unknown. Whether the `/refresh` secret header, the `/healthz`-after-failed-hydrate fix and the signing-key dual-window items have landed (#868/#871?) is unconfirmed. |
| 2026-09-30 | Docs-sweep leftovers | ✅ Merged + live (launcher only) | [PR #876](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/876) (`022e0888`). **Comments:** stale comments fixed in `ktx2Encode.ts` (mipmaps off) and in `flipbookExport.ts` and `bake-editor-doc.mjs` (clips are pruned); this closes flipbook open item 6. **Script:** `bump-game-engine.mjs` deleted, with no other prescriptions left anywhere. **Desktop launcher:** its `roles.ts` install steps now lead with publish/deliver, and ComfyUI is optional. **/comfyui:** the note now points to Custom nodes instead of the Dockerfile. **CI:** `check:toolbar-icons` added to Lint's launcher gates and confirmed running. **Note for the CI-harness PR (branch `ci/check-all`):** it auto-discovers `scripts/check-*.mjs`, so it must exclude toolbar-icons or drop it from Lint to avoid running it twice. |
| 2026-09-29 | Guides re-check (a duplicate chip that woke late) | ✅ Merged (docs only) | [PR #874](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/874) (`3a252052`). It didn't redo #867; it verified it against main and fixed 13 drift spots in the guides (games is DNS-only, so check `/healthz` `lastHydrate`; launcher links boot the authoring mock after #870; `TEST_SERVER_SECRET` consumers and header; stale "not in INFRA" claims). It adds 2 more Traps, for ~58 in total. Memory candidates: 21 already covered, ~37 fixed in code, ~45 dev-internal, 2 unconfirmed. **Still open:** the admin page's purge hint still says `games` is behind Cloudflare (a task chip was raised). **Owner call:** the R2 endpoint, which contains the Cloudflare account id, is hard-coded in `nightly-backup.yml`, INFRA, `backups.md` and 3 `.env.example` files in the public repo. Move it to a repo variable or accept it. |
| 2026-09-29 | Docs drift sweep (Appendix B) | ✅ Merged | [PR #872](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/872) (`27555425`). Of ~52 claims, about 43 fixed; about 7 already fixed by later PRs; 2 not applicable (the Cinematic line kept on purpose; the desktop README lives in another repo). **Two Appendix B premises were wrong:** `games` is DNS-only (not behind Cloudflare), and the desktop launcher still offers optional ComfyUI. `STATUS.md` re-audited for #811–#870. `CLAUDE.md` no longer claims E2E/Chromatic, and its April state section is gone. The long status files for engine, flow, rigger, symbols and flipbook are split into `<tool>-history.md`. Rule 9 passes 21/21. Rebased over #867–#871, so the mock/published gap now reads as closed in every doc. **Account and endpoint IDs removed from INFRA/status.** **Leftovers:** the `/comfyui` page note (edit Dockerfile); stale code comments in `ktx2Encode.ts` (mipmaps) and `flipbookExport.ts`/`bake-editor-doc.mjs` (reachability); `scripts/bump-game-engine.mjs` still exists; the `roles.ts` desktop install steps still lead with ComfyUI; `check-toolbar-icons.mjs` isn't in CI. |
| 2026-09-29 | Runbooks + first-game guide (§4.5, Gate E) | ✅ Merged (docs only) | [PR #867](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/867) (`54fc034e`). **New guides:** `docs/guides/` `build-your-first-game.md`, `publish-and-deliver.md`, `release-and-rollback.md`, `rotate-a-secret.md` and `incident-first-response.md`, linked from ONBOARDING and a new "Guides & runbooks" table in STATUS. **~60 author-facing traps** migrated from personal memory into "## Traps" sections across 20 tool guides, each verified against current code. Stale guide claims were corrected, and INFRA's R2 row now lists every consumer. **New open issues found (follow-up sessions started):** (1) the mock reads **live** config while players boot the **published** one, so an unpublished math change desyncs them; (2) Config, Win Text and Localization have no unsaved-work guard; (3) the launcher's `/refresh` calls send no `TEST_SERVER_SECRET`; (4) the games `/healthz` says ok after a failed hydrate; (5) the tool signing secrets have no dual-key window, so a rotation causes a short 403. **Also:** a stale UI hint in `EditorProperties.svelte` (~l.3481). INFRA still publishes the CF Access client id and the pod/tunnel ids — owner's call. |
| 2026-09-29 | Nightly Postgres + R2 backups, test restore (§7.2) | ✅ Merged · **dormant until owner setup (~25 min)** | [PR #864](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/864) (`414f8ae6`). **Job:** `scripts/backup/iwbackup.py` via `nightly-backup.yml` at 02:37 UTC. **Postgres:** `pg_dump -Fc` from a snapshot with row counts, test-restored every night into a throwaway PG 18; all counts must match. **R2:** authored docs (~2.2k objects, 5.4 MB) and assets (~13.4k objects, 3.3 GB) archived; regenerable prefixes excluded. **Storage:** age-encrypted to public keys (the job can't decrypt), in a separate `invisible-backups` bucket with its own scoped tokens. Lifecycle 35 / 90 / 14 d plus a 7-day lock. A failure opens a GitHub issue. Hardened for the public repo (masked output, no artifacts, main-only environment, hash-pinned deps). **Findings:** R2 has no object versioning, so a nightly copy is the answer (< $1/month); Railway's built-in DB backups are Pro-only. **Test restore passed:** 17/17 tables matched, 2,199 docs and 13,431 assets byte-verified; every guard refused as designed. Found 17 case-only key collisions in `borut/bookofborut/`, now restored safely. **Runbooks** A–E are in `docs/guides/backups.md`. **Owner:** the 8 steps in that guide. Set the environment to main-only **before** adding secrets. **Conflicts with §2.1:** `BACKUP_DATABASE_URL` uses the Postgres **public proxy**, so closing the proxy would break the backup. |
| 2026-09-29 | Signed launcher handoff for Atlas + Sheet (§2.1) | ✅ Merged + live · **inert until owner sets 2 secrets** | [PR #863](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/863) (`4837fcc8`). **Token:** the launcher mints a 120 s HMAC token (`sub`, the real `uid`, name, role, client, project, caps), and the redirect carries only `?iw_launch=`. Server-to-server calls use `typ:"api"` via `X-IW-Launch`. **Tools:** `iw_common/launch.py` verifies it once and sets a signed 12 h session cookie; URL client and project are ignored. Blueprint publishing becomes a capability. With no secret on Railway, the tool fails closed. **Render slot** has an owner: Stop is owner or admin only, and the UI shows who is rendering. **`/healthz`** needs no login and reports the commit. The person-level lease (concurrency Phase 3) is unblocked. **Tests:** `test_launch_gate.py` on both tools (tampering, replay, wrong tool or type, the legacy window, fail-closed) and `check:tool-launch-token` in CI. **Verified live:** `/healthz` returns 200 on both at `4837fcc8`; forged tokens and headers and bare `?client=` return 403. The legacy URL isn't clicked live yet (needs a signed-in launcher). **Owner:** `ATLAS_TOOL_SIGNING_SECRET` (launcher + atlas-tool) and `SHEET_TOOL_SIGNING_SECRET` (launcher + sheet-tool); set the tool side first; optionally set `IW_LEGACY_TOOL_KEY_UNTIL=off` once verified. **Cut-over 2026-10-13:** remove the legacy secrets and the legacy code branch. Note: Railway still built `atlas-backend`, so it is not deleted yet. |
| 2026-09-29 | RGS transport: timeout, resend, reconnect (§5.3) | ✅ Merged + live (runtime release) | [PR #858](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/858) (`f3196ea6`); docs in [#862](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/862). **Resend:** a lost request is resent at the **same seq/gid** on a network error, a 15 s timeout, 5xx/408/429 or an empty 200; every 1 s, up to 90 s, then a reload prompt. seq advances only when the server accepts; nothing is sent while offline; one request at a time. **Round-opening bet:** never resent blind. The transport probes first and replays only under a round the server marks `updating`; otherwise the player reloads and resume finishes the round. **Overlay:** "Reconnecting…" / "Connection lost / Reload", localizable. **Mocks** replay by session+gid. **Review fixes:** a double-charge path, a poll race, and closed-round probes read as open. **Tests:** `check:connection` in CI; fault-proxy runs show one stake in each case. **Verified live:** remake on the test server (4 spins) and on the partner's test node (6 rounds), 0 errors. **Missing collect: settled, not our bug** — losing spins close themselves, confirmed across 16 partner rounds. **Owner:** run the 4-step partner replay check (protocol reference § "Checks owed on the live node"). **Finding:** Chromium can resend a POST on a dead keep-alive connection and double-stake; only the server can fix that, so raise it with the partner. **Trade-off:** a lost round-opening answer means a reload. **Found:** the apps/lines dev server crashes in SSR on `packages/error-tracking` extensionless imports (#852); production is unaffected, and a separate session is on it. The overlay is not yet authorable. |
| 2026-09-29 | Component-defaults history + Scene Editor history modal (§4.3, follow-ups to #847) | ✅ #857 + #859 merged + live | [PR #857](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/857) (`016a94c9`). **Component defaults** now back up through `putDocWithBackup`, per component, under `component-defaults-backups/<slug>/`, which sits beside `component-defaults/`. `/components` gets **History…**; a restore keeps an unsaved draft. A save storage failure is now a retryable 502. **Shared-helper fix (all 5 docs):** only an autosave copy starts the 5-min window. Previously, restoring the oldest backup at the limit could lose the restored version. A new check fails on the old helper. **Tests:** `check:doc-backups` 184/184 (mutation-checked); route live on test2. [PR #859](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/859) moves Scene Editor History onto the shared `DocHistoryModal`, with guards for in-flight saves and failed restores. Merged as `4f32e773`; docs in #861. Live on test2, the modal mounts and fetches the backups (empty state). All five authored docs now share one picker. **Still open:** the flow function library has no server history; a stale-tab restore isn't browser-tested; restore hasn't been clicked live for symbols, config or component defaults. |
| 2026-09-29 | Flow undo/redo + rolling doc backups for flow, symbols, config (§4.3, §7.2) | ✅ Merged + live (launcher only) | [PR #847](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/847) (`ad4c0661`); docs in [#856](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/856). **Undo:** `/flow-v2` has 100-step undo/redo (`undoHistory.ts`). Same-key edits within 800 ms coalesce; gestures count as one step; Ctrl/Cmd+Z and Shift+Z/Y plus toolbar buttons. An undo saves through the normal conditional autosave, and undo is disabled when the doc is read-only. **Backups:** the new `docBackups.ts` (replacing `editorDocBackups`) backs up → guarded PUT → prunes. It keeps 20, at most one per 5 min, and takes none on a save that will 409. It covers scenes, flow, symbols and game config. **History:** a shared `DocHistoryModal` with a **History…** button in /flow-v2, /symbols and /config; restore goes through the guarded save. **Tests:** `check:doc-backups` 149/149 (mutation-checked), `check:undo-history` 10/10, and the gates. **Verified live** on test2: undo, a backup listed, restore, and the flow byte-identical. **Still open:** component defaults have no backups (component-editor #6); the shared function library has no server history; a stale-tab restore isn't browser-tested; a config/symbols restore isn't click-tested; the Scene Editor still uses its own history picker. |
| 2026-09-29 | Paytable matches the real RGS (§4.4, §5.3) | ✅ Merged + live (runtime release) | [PR #855](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/855) (`8f1f78b5`). **Scatter pays:** authorable (the scatter symbol's own `paytable`; default 2/20/200). `shownPaytable` is the single definition of what the info page shows, and the lines mock pays the authored row. **Import:** /config "Import from a pasted capture" (`findCapturedConfig`, a review diff); stored as `doc.partnerPaytable`, stripped from bundles. **Drift gate:** a red banner in /config; online Publish refuses with `paytable-drift` (owner override); the desktop bake/delivery stops unless run with `--allow-paytable-drift`. **Info page:** "MAX WIN — N× BET", plus an RTP rule only when the operator's `displayRTP` is set. **Tests:** new fixtures in CI. **Verified live:** the remake paytable is byte-identical and it serves the new release. An R2 scan found no authored scatter paytables, so no live payouts changed. **Owner:** check the paste dialog and banner in a browser. **Decision:** the lines mock's placeholder pays scatter 4:10/5:100 while the page shows 4:20/5:200, and the book mock declares scatter pays but pays 0. Neither was changed. **Still open:** partner-math games must author their real `max_win` (templates say 5,000); the book `maxWinMp` isn't read; per-mode RTP isn't shown. |
| 2026-09-29 | Error tracking, health, alerting, uptime (§7.3) | ✅ Merged + live · **dormant until owner sets DSNs** | [PR #852](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/852) (`e6ce4db8`). **Sentry** with a shared scrubber (`packages/error-tracking`); the default data collection is off, and sid, token, k and session params are scrubbed. It covers the game runtime (tagged with release sha, game, project and profile; captures RGS failures and boot failure), the launcher (`handleError` on server and client) and atlas-tool/sheet-tool. Everything is a no-op without a DSN. Delivery builds are off unless the profile bakes `telemetry.errors:true`. **`/api/health`** now checks readiness (Postgres plus migrations current); a failed migration returns 503 instead of silently logging. A failed runtime release opens or comments on a GitHub issue. **Verified:** health returns 200 with db ok live; the no-DSN bundles contain 0 "sentry" strings; events arrive scrubbed at a fake ingest; a delivery with no opt-in sends 0 requests. **Owner actions:** (1) Sentry EU org with 3 projects plus alert rules; (2) the `PUBLIC_SENTRY_DSN` GitHub secret, then re-run the release; (3) launcher `SENTRY_DSN` + `PUBLIC_SENTRY_DSN`; (4) tools `SENTRY_DSN`; (5) **launcher healthcheck `/api/health`, timeout 300**; (6) 4 Better Stack monitors including a non-Spain region (config in INFRA.md); (7) watch repo Issues. **Still open:** source-map upload; atlas and sheet `/healthz` (the handoff session); a bodiless authenticate non-2xx is not reported; the bundle grows ~97 KB with a DSN. |
| 2026-09-29 | Model licence audit (§2.2) | 🟡 Audit merged; **switches await owner/legal** | [PR #851](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/851) (`9fd26dcb`); write-up at `docs/reference/model-licences.md`. **Every built-in image default is non-commercial as wired today.** SDXL: the `gameIconInstitute3d` LoRA is always wired and is NC/ND; Juggernaut is conditional (allowed with credit). FLUX.1-dev, Redux and `comic-style-lora` fall under the FLUX [dev] NC licence. RMBG-2.0 (the default cutout) is CC BY-NC. Every PuLID path needs InsightFace antelopev2, which is NC. **Clean:** Qwen-Image 2512, FLUX.2 klein 4B, Wan 2.2, gpt-image, the SDXL ControlNet and IPAdapter. **Unknown:** BiRefNet_toonout, facexlib, InSPyReNet, SAM3, and what the R2 blueprints and the volume use. **Recommended (not applied):** RMBG → BEN2 or BiRefNet (MIT); SDXL LoRA optional and off by default (small code change); keep Juggernaut with a credit line; character and hero art → Qwen-Image or klein, with FLUX.1-dev R&D-only or a BFL licence; retire PuLID for shippable work. **Shipped (inert):** a `model_licences.json` manifest; per-render `provenance.json` with a worst-of verdict; atlas `regions[].provenance`; flipbook provenance. Tests: 305/305; not yet seen on a live render. Not legal advice. |
| 2026-09-29 | Versioned engine runtime releases + rollback (§3.2) | ✅ Merged + live, drill done | [#844](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/844) (`d547a598`), [#848](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/848), [#849](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/849), [#850](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/850). **Releases:** each one goes to an immutable `_runtime/lines@<commit12>/` and is made live by a CAS flip of `current.json`; `releases.json` holds the history. The test server resolves the pointer, keeps the last good one on errors, and keeps the previous chunks for players mid-session. **"Runtime rollback" workflow:** rollback, promote, pin, unpin and list, with no rebuild. **Canary:** pin one game via `runtimeVersion`. **Retention:** last 10 releases plus current, previous and pinned. The stale "Releasing engine…" pill is fixed. **#848:** a test-server refresh went from 160 s to 1.6 s. **#849:** snapshots record their engine version (a record, not a pin). **Drill:** rollback 47 s (took #846 off every game), roll-forward 38 s, unpin 41 s. Upload is 16 s, down from 2m08s. The remake was checked before, during and after. **Decision:** data rollback and engine rollback stay separate levers; publish does not pin. **Still open:** 1.24 GB of old flat `_runtime/lines/**` can be deleted once you're happy with the pointer; auto-release always promotes (canary is manual); Lint is still not required. |
| 2026-09-29 | Frozen runtime snapshot at Publish (§3.2, §8.1) | ✅ Merged + live | [#841](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/841) (`d562dfc`), [#843](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/843), [#845](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/845). **Publish:** assembles once under a per-project lock and re-validates the shipped flow. It freezes `published/<id>/runtime.json` plus a CopyObject copy of `deploy/`, then CAS-flips `published/pointer.json`. **Player boots:** read the snapshot (ETag, 304 on reload, `immutable` assets); authoring boots stay live. Unsnapshotted games fall back to live, logged. **Deploy writers:** everything that writes `deploy/` runs under `withDeployWrite` (a per-project mutex, max 2 assembles launcher-wide). **Rollback:** 5 snapshots kept, "Make live" is a pointer flip, and a flow-override revival is owner-only. **Honest failure:** a failed player boot shows "This game could not load" instead of the sample game. **Boot time:** remake 20–25 s → 0.26–0.35 s (113 ms in the browser); test2 5–6.5 s → ~0.3 s; test6 26 s → 0.5 s. **Verified live:** remake and test2 serve from snapshots, 74/74 assets come from the published copy, and R2 integrity is 105/105. A test2 rollback and roll-forward worked, and a wrong key shows the error screen. **Owner action:** test4, test5 and any other legacy game are still on live fallback. Run Game Maker **Republish all**, which freezes whatever each project currently has saved. **Still open:** authoring boots still take 20–26 s. An engine contract change needs Republish all afterwards. Launcher Games and partner cards still open live data (deliberate). The deploy lock is in-process only. A hook for the versioned-runtime session: record the engine version in the snapshot. |
| 2026-09-29 | Gold Rush buy cost ($100 shown, $1 debited) | ✅ Merged + live (test server only) | [PR #840](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/840), merge `156e6f09`; docs in [#842](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/842). **Root cause: the mock RGS.** The card and the request were right: the facade sends option index 1 per Play4Fun `betOptions` semantics. The book mock read that index as a cost multiplier. **Fix:** the mock charges `betOptions[x] × M` and refuses an out-of-range option. The expanding free-spin special now pays on the base stake. No engine change. **Test:** `check:buy-cost` added to `check:rgs`; 9 checks fail on the old mock. **Verified live:** a real $100 buy on the remake debited 10000, and balance and win add up. **Still open:** test6's Buy button has a different cause, probably the pre-#833 scaffold shape; it needs the authored layout inspected with a token. There's also an engine cleanup of the facade's dead pre-table buy branch, logged in `engine.md`. |
| 2026-09-28 | Upload serving, security headers, login throttle (§2.1, §2.1) | ✅ Merged + live | [PR #827](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/827), squash `7e089da4`. **Uploaded files:** the new `$lib/server/userContent.ts` picks the Content-Type from an extension allow-list and adds `nosniff` and a sandbox CSP. HTML, SVG, XML and unknown types are served as downloads. It covers editor/font assets, `/spine/file` and `/api/files/download`. The FTP upload now stores the type derived from the extension. **Storybook:** it keeps inline pages under its own CSP, and the FTP browser now refuses writes into any `storybook/` prefix. **Headers:** HSTS, `nosniff`, `Referrer-Policy` and `frame-ancestors 'self'` on every dynamic response. **Throttle:** `ADDRESS_HEADER`/`XFF_DEPTH` now have code defaults, and login timing is the same for known and unknown emails. **Verified:** `curl -I` shows the headers live, and the published engine storybook raises 0 CSP violations. **Still owed (owner):** upload an `.html` file in `/files` and click it; it should download. Take a quick look at a project storybook and at the editor/fonts. **Follow-up gap:** static files served directly by adapter-node (`/spine/view.html`, `/shared/*`) skip `hooks.server.ts` and don't get the baseline headers. There is still no full-page CSP on the tools. |

---

## 1. Executive summary

**The pipeline is feature-complete enough to operate. The things around the features are not.**

**What is solid today:**
- Every tool in the launcher exists and does its core job.
- All 21 registered tools have a user guide.
- Every asset class ships through the full export → `deploy/` → bake → pull → register chain, except one small gap.
- A lines, Book-of or ways game can be authored and published entirely from the portal. The Book of Borut remake runs on an authored Flow v2 graph in production.
- Generation no longer depends on the local GPU.
- Build size dropped from 66 MB to 50 MB, verified live.
- The Game Maker assemble step went from 93 s to about 25 s.

**What stands between today and "operative" is five things. None of them is a missing feature:**

1. **Security.** Four problems:
   - A forgotten service (`atlas-backend`) is live, unauthenticated, and should not have been deployed.
   - The engine repo is **public**, with GitHub secret scanning off.
   - Any signed-in user can fetch the GitHub clone token.
   - Isolation between clients is enforced only at the launcher's front door. Atlas and Sheet trust whatever client and project the URL names.
2. **Release safety.**
   - **Every merge to `main` is a deploy to every online game.** Nothing gates it: lint is not required, and the release job runs no checks. It overwrites the runtime in place, with no staging, canary or one-click rollback.
   - **Every save in an authoring tool is also a deploy.** Online games boot from live authoring data.
   - Nothing reports errors from players' devices.
3. **Data safety.**
   - Only the Scene Editor doc has version history. R2 versioning is off, and no Postgres backup procedure is documented.
   - Flow and Rigger have no undo.
   - Three tools' manual Save silently overwrites a colleague's work. This is a one-line bug, flagged in the code's own comments and never fixed.
4. **Verification debt.**
   - About 80 "⏳ verify owed" markers sit in the four authoring tools alone. There are more in the Rigger, Atlas, Sound, Config, FTP and delivery.
   - Many test harnesses exist and pass, but CI runs almost none of them.
   - Today's #807 moved the free-spin rounds onto the authored flow, and nobody has looked at it live yet.
5. **The regulated half of delivery.**
   - About 20 operator settings are still ignored, including RTP display, minimum spin time, autoplay limits and the reality-check clock.
   - The RGS transport has no timeout or resend.
   - The paytable shown can differ from the one a real RGS pays.
   - No delivery has yet been hosted on a partner's real CDN and embed page.

**My central recommendation: declare a feature freeze now and spend the month on five gates** (§9):
- **A.** Safe to leave running.
- **B.** The team can author without losing work.
- **C.** A merge or publish can't silently break live games.
- **D.** First real-money delivery.
- **E.** Not dependent on one person.

Churn since 2026-08-15 has been very high: 299 commits touch the launcher, 197 the engine, and 101 the Atlas Maker. Every new feature this month competes directly with the hardening list.

### 1.1 Scorecard

Legend:
- ✅ production-ready
- 🟢 usable, minor polish
- 🟡 built, needs verification or hardening
- 🟠 in active development
- 🔴 not built / blocked

| Area | Component | Verdict | One line |
|---|---|---|---|
| **Asset generation** | Invisible Atlas Maker | 🟡 | Core generate → compose → deploy on RunPod is in daily use. The 09-16 → 09-22 features have never been rendered live. There is one render slot for the whole service. |
| | Invisible Blueprints (Atlas feature) | 🟡 | All 8 phases built and used live. Resolving a model against the R2 mirror is built; getting the model onto the machine is not. |
| | Invisible Sheet Maker | 🟢 | Low churn, tests green. One browser pass owed. |
| | Invisible Font Maker | 🟡→🟢 | Ship chain and glyph guard built. Owed: a browser pass and one font taken through publish. |
| | ComfyUI / RunPod backend | 🟡 | Off the local GPU. The endpoint's image pin, execution timeout and spend caps are not recorded anywhere. |
| **Animation & VFX** | Invisible Rigger | 🟡 | Feature-rich, but the least-protected save of any tool: no conflict check, no undo, no backup, no unsaved-work guard. |
| | Invisible Cinematic | 🟡 | Editor complete. The in-game half has **never run in a real game**. |
| | Invisible Flipbook | 🟡 | Clips 🟢. Video mode needs the BiRefNet weights pre-fetched and one observed session. |
| | Invisible FX | 🟢 | Complete. Manual Save force-overwrites (one-line fix). |
| | Invisible Spine Viewer | ✅ | Production-ready. Only doc cleanup left. |
| **Game authoring** | Scene Editor | 🟡 | The most solid authoring tool (undo, backups, leases). The editor canvas can drift from the game render, and a field allow-list silently drops new fields on save. |
| | Component Editor | 🟢 | Usable. No autosave. The per-game defaults file has never been written live. |
| | Invisible Flow (v2) | 🟡 **highest risk** | Owns the free-spin rounds since today (#807). No undo, no backups, validation is advisory only, and a second wire out of an exec pin silently does nothing. |
| | Symbols State Machine | 🟠 | Still getting weekly fixes. Force-save bug. The black-box symbols fix on phones is unconfirmed. |
| **Game setup** | Game Maker | 🟡 | Create, duplicate and publish work. Every player boot re-runs all seven exporters. The guide says things don't work that now do. |
| | Game Config | 🟡 | The tool is solid, but **the paytable shown can differ from what a real RGS pays**. |
| | Localization | 🟢 | Translations reach the game, reviewed strings only. Force-save bug. Translation provider env unconfirmed. |
| | Win Text | 🟢 | Complete. Counts 2–5 are hard-coded. Verification owed since July. |
| | Invisible Sound | 🟡 | Built, and transcodes on export. One click-through owed. Deleted sounds linger in desktop and delivery builds. |
| | FTP Browser | 🟡 (→🟠) | Not live-tested since June. Uploads were broken for about 3.5 months and nobody noticed. |
| | Storybook | 🟢 | Peripheral. Published manually. |
| **Platform** | Web launcher: auth, roles, admin | 🟢 core · 🟡 security | Sound auth design. Several project-isolation gaps. No security headers. |
| | Multi-user concurrency | 🟢 | The exceptions are the three force-save sites, the Rigger `.irig`, and Atlas/Sheet manifests. |
| | Docs coverage (rule 9) | ✅ | All 21 tools have a guide and a README row, and every link resolves. |
| | Desktop Invisible Launcher | 🟡 | Works for the lead dev. ☁ Publish needs the owner's whole-bucket R2 key. |
| **Ship** | Asset ship chain | 🟢 | Every class ships, except the boot splash on the bake path. |
| | Runtime release | 🟡 | No gates, no rollback, overwritten in place. The job goes green even when the new bundle isn't served. |
| | Online game serving | 🟡 | Boots from live authoring data, runs a full export per boot, has no CDN, and the launcher has no healthcheck. |
| | Delivery builds | 🟡 built · 🟠 regulated | Packaging is complete. About 20 host settings are ignored. Never hosted on a partner CDN. |
| | KTX2 / build optimization | 🟢 | Verified live. The alignment guard isn't in CI. |
| | Test server (the online demo host) | 🟢 as demo | Must never become a money authority. Every refresh resets all demo wallets. |
| **Engine** | Runtime core | 🟡 | Rich and well documented. Four regressions reached every online game since August. |
| | Game types | lines 🟢 · bookOf 🟢 on the mock / 🟡 against the partner · ways 🟡 · cluster 🟠 · scatter 🟠 | Cascade wire formats are our own invention; the partner has none. |
| | RGS / Play4Fun integration | 🟡 | No timeout, no resend, gamble/picks not built, replay throws. |
| **Infra** | Service inventory | 🟡 | The launcher is a single point of failure for every online game boot. |
| | Security | 🔴 | See §2. |
| | Backups / disaster recovery | 🔴 | No R2 versioning, no documented Postgres backup, no restore drill. |
| | Monitoring / alerting | 🔴 | No error tracking, no uptime checks, no spend alerts. |
| | CI | 🟡 | Lint and a few gates run. There is no build step, no svelte-check, no E2E, and no branch protection. |

### 1.2 The ten things I'd do first

1. ✅ **Delete the `atlas-backend` Railway service** — done 2026-09-30, verified 404. §2.1 (Cloudflare Access token rotation: not required — owner decision 2026-09-30.)
2. **Decide the repo's visibility.** If it stays public, turn on secret scanning and push protection. Size S. §2.1
3. **Look at the Book of Borut remake's free spins live today.** #807 and #810 changed every online game's free-spin flow this afternoon. Then sweep projects for old `FreeSpinIntro`/`FreeSpinOutro` composer binds. Size S. §5.1
4. **Fix the three force-save buttons.** It's `onclick={() => save()}` plus a CI scan, under an hour. §4.3
5. **Set the launcher healthcheck** to `/api/health`. This ends the ~104 s outage on every deploy. Size S, owner. §3.2
6. **Gate the runtime release.** Checks run before publish, and the job goes red if the new bundle isn't served. Also protect `main` so Lint is required. Size S. §3.2
7. **Back up Postgres nightly and sync R2 project docs nightly, with one restore drill.** Size M. §7.2
8. **Close the launcher isolation gaps.** Four of them: gate `git-credentials`, re-check project access in `toolScope.gate`, add an access check to `/api/lease`, and check the destination client on duplicate/create. Size S each. §2.1
9. **Harden the Flow editor.** Four pieces: seed the flow at project creation, validate at publish, flag exec-pin fan-out, and add backups plus undo. Size S×3 + M. §4.3
10. **Harden the Rigger save.** Conditional `.irig` save, validate before writing, rolling backup, and a `beforeunload` guard. Size M. §4.2

---

## 2. Security findings (all closed)

The audit found a handful of security gaps. All of them were closed during the sprint; this
section records what was found and what fixed it.

### 2.1 Findings and fixes

| Finding | Fix | Where |
|---|---|---|
| A retired backend service was still deployed and reachable without sign-in | Service deleted from Railway; source removed from the repo | Owner, 2026-09-30; [#883](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/883) |
| Public repository without secret scanning or branch protection | Secret scanning + push protection on, extended scanner + CI job, `main` ruleset with required checks, org 2FA | [#838](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/838), [#881](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/881), owner settings |
| Some launcher endpoints trusted a project or client from the request without an access check; admin capability could be over-granted | Access re-checked on every authoring API, lease, duplicate/create, deploy files and partner sessions; admin role grants restricted; password reset revokes sessions | [#811](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/811), [#812](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/812), [#814](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/814), [#818](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/818), [#826](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/826) |
| The art tools took their client/project scope from the launch URL | Launcher-signed, short-lived launch tokens; scope comes from the token only | [#863](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/863) |
| User uploads could be served inline; no baseline security headers | Content types from an allow-list, `nosniff`, risky types served as downloads, HSTS and frame protection | [#827](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/827) |
| Login throttle relied on dashboard-only settings; password rules were weak | Code defaults for the throttle, uniform login timing, self-service password change with a 12-character minimum | [#827](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/827), [#944](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/944) |
| Secret rotation overdue; one storage key shared by every publisher | Desktop publish moved to the portal relay (no shared key on desktops); rotation runbook written | [#866](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/866), [invisible-launcher#14](https://github.com/Invisible-Wall-SL/invisible-launcher/pull/14), `docs/guides/rotate-a-secret.md` |
| Dependency advisories with no alerting | Dependabot configured (Spine held at 4.2.x) and the first updates taken | [#901](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/901), [#916](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/916), [#927](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/927), [#936](https://github.com/Invisible-Wall-SL/Invisible-Engine/pull/936) |

### 2.2 Legal: production defaults use non-commercial models
This is not a security problem, but it blocks commercial output just as hard.

- `services/atlas-tool/batch_atlas.py` `_DEFAULTS`:
  - `rmbg_model: "RMBG-2.0"` (line 82) is on by default for every built-in pipeline. BRIA lists RMBG-2.0 as CC BY-NC 4.0; confirm this.
  - `flux_unet: "flux1-dev.safetensors"` and `flux1-redux-dev` (lines 112, 124). FLUX.1-dev is under a non-commercial licence.
- The production worker bakes PuLID (`services/atlas-comfy-pod/nodes.json`, flagged `prod`). It needs InsightFace antelopev2, which is non-commercial. That is the same reason `status/comfyui.md` keeps PuLID-Flux2 R&D-only.
- The SDXL defaults (the Juggernaut checkpoint and the `gameIconInstitute3d` LoRA) have no licence recorded.
- Nothing marks an asset as made with a non-commercial model.
- **Fix:** **MUST, M.** Do a licence audit. Then either switch the defaults to cleared models (a permissive matting model, FLUX schnell, or the Apache-licensed Qwen-Image path) or get a legal sign-off. Tag each generated asset with the models that made it.

---

## 3. Launcher, publish and deploy: how it actually works today

### 3.1 Two different products

**"Online" and "delivered" are two different things, and most production risk sits in the online path.**

- **Online games** (`games.invisiblewall.org`) are **demos on our infrastructure**. The test server hosts them and they play against the **mock RGS**. On every player boot they assemble the game live from the current authoring data.
- **Real-money play** goes through a **delivery**: a frozen folder the partner hosts, talking to the partner's RGS. The other real-money route is the shared runtime bundle launched with `?rgs_profile=…`, which is still served through our test server and launcher.

```
AUTHORING (portal tools) ── save ──► R2  <client>/<project>/{editor,symbols,config,sounds,fonts,spines,…}
                                          │
        ┌─────────────────────────────────┴────────────────────────────────────┐
  ONLINE (demo, mock RGS)                                     DESKTOP ☁ PUBLISH / 📦 DELIVER (frozen)
  player → games.invisiblewall.org/<key>/?runtime=1           Invisible Launcher (separate repo, 8.1k-line .py)
        │  test-server serves the shared _runtime/lines          │ git reset --hard origin/main
        │  (in memory; refreshed by POST /refresh)               │ engine submodule → origin/main
        ▼                                                         ▼
  GET app.invisiblewall.org/api/editor/runtime   ◄── two ──►  bake-editor-doc.mjs → /api/editor/export-*
   = ALL exporters on EVERY boot (~25 s, writes      paths,     (no boot-splash export)
     R2 deploy/, 10 s cache) → JSON bundle           no parity  pull-project-assets → static/assets/
        │                                            check      pnpm build
        ▼                                                         │
  art streamed via launcher /api/deploy/f/… (no CDN)          ☁ → R2 test_server/<key>/ + games.json (CAS)
        │                                                        → /refresh → verify served hash → card
        ▼                                                     📦 → build-delivery.mjs → game.js + EMBED.md
  mock RGS on test-server (shared demo wallet),                    + partner embed.html + zip
  or partner RGS via ?rgs_profile + /api/partner-session          → ▶ serve-embed preview → partner CDN

ENGINE CODE: merge to main ─► runtime-release.yml (no checks) ─► overwrite R2 _runtime/lines in place
             ─► /refresh (best effort; warns on failure) ─► ALL online games switch
             desktop builds pick it up on their next build
```

### 3.2 Stage-by-stage

| Stage | Verdict | What's wrong | Fix |
|---|---|---|---|
| **Asset ship chain** | 🟢 | See detail 1 below. | MUST S: boot-splash export on the bake path. SHOULD S: `build-delivery.mjs` fails on missing art. SHOULD M: have the bake fetch the same `ensureDeployExports` payload so there is one assembly path. |
| **Runtime release** (`runtime-release.yml`) | 🟡 | See detail 2 below. | MUST S: gates inside the release. MUST S: go red unless the served hash matches. MUST S: branch protection (Lint required). MUST S: teach `check-undefined-names` to read `.svelte` `<script>` blocks. MUST M: versioned `_runtime/lines@<sha>/` behind a pointer file, so rollback is a pointer flip and an optional canary id can pin one test game. |
| **Online game serving** | 🟡 | See detail 3 below. | MUST S (owner): healthcheck. MUST M: **freeze a runtime snapshot at Publish.** Player URLs read the snapshot; `ie_authoring=1` keeps live assembly. That takes exports off the read path and gives Publish a real meaning. SHOULD M: serve `deploy/` through a CDN hostname. |
| **Desktop ☁ Publish / 📦 Deliver** | 🟡 | See detail 4 below. | MUST S: portal relay as the default route, R2 key optional. MUST S: align Optimize with `nearLossless: 40`, or skip pages the server already encoded. MUST S: stamp every delivery (version, time, engine SHA, game SHA, lockfile hash) in `EMBED.md` and `__IE_BUILD__`. SHOULD S: a one-page publisher runbook and README refresh. SHOULD S (owner): grant `gamePublish` to developer and pipelineTester. |
| **Delivery builds** | 🟡 built · 🟠 regulated | See detail 5 below. | See §5.3. MUST S: a handover rehearsal on partner staging with a checklist. |
| **KTX2 / optimization** | 🟢 | See detail 6 below. | MUST S: put `check:ktx2-alignment` and `check:page-store` in CI. SHOULD M: move encoding to a worker. MUST S–M: device pass (§5.1). |
| **Test server** | 🟢 as a demo host | See detail 7 below. | SHOULD S: per-player sessions, and don't recreate unchanged mocks. SHOULD S: confirm the secret and send it as a header. COULD: rename it (e.g. "Invisible Game Host") so nobody treats it as disposable. **Policy MUST:** it never becomes a payout authority. |
| **New game repos** (`scripts/new-game.mjs`) | 🟢 | Workspace deps are backfilled only at build time, so the committed repo drifts. `verify-scaffold-template.mjs` isn't in CI. | SHOULD S: add it to CI. |

Detail for each stage:

1. **Asset ship chain**
   - Every class is exported, baked, pulled and registered: layout, component defs/defaults, editor art + KTX2, spines/rigs, symbols, fonts, sounds, FX, rig FX, flipbooks, rig flipbooks, cinematics, flow v1/v2, localization, win text and config.
   - **Gap:** the boot splash (`_boot/`) is exported only on the online path (`runtimeBundle.ts:586`). Desktop and delivery builds ship whatever the last online publish left behind.
   - The online path and the desktop bake are two hand-kept assembly paths with no parity check. The boot-splash gap is an instance of exactly that.
   - Missing art only warns, so a publish still ships blank.
2. **Runtime release** (`runtime-release.yml`)
   - It fires on any push to `main` that touches `apps/lines/**` or `packages/**`. Lint is not a required check, and the release runs **no** checks: no build test, no fixtures, no boot.
   - `publish-runtime-bundle.mjs` overwrites `test_server/_runtime/lines/` **in place**, file by file: not atomic, with no old version kept.
   - If `/refresh` doesn't take, the job **warns and exits 0**. Seen today on #799: the old bundle was still served 12+ minutes after a green run.
   - Rollback means reverting on `main` and waiting about 10+ minutes, and it isn't documented.
   - Four regressions have already reached every online game this way: #373 (free spins hung), #396 (an infinite `$effect` loop), #549 (a rig blanked the reels) and #566 (every board blank for about 20 minutes).
   - The undefined-identifier gate scans `.ts` files only (`scripts/check-undefined-names.mjs:70`). **Both** blank-board incidents were a missing import in a `.svelte` file.
3. **Online game serving**
   - **Every player boot runs every exporter** (`runtimeBundle.ts:409`), which takes about 25 s. The 10 s cache TTL (`runtimeBundleCache.ts:55`) is shorter than the assemble, so it almost never hits. There is no concurrency cap, on a launcher that has run out of memory on bakes before.
   - **Publish is only a pointer.** An author's half-finished save is what the next player sees.
   - All art streams through one Node process (`/api/deploy/f/…`, about 50 MB per boot, no CDN).
   - **The launcher has no healthcheck**, so there is a ~104 s window on every push where boots fall back to the engine's *sample* game. Status unverified since 2026-09-18.
   - If the runtime fetch fails, the game waits up to 210 s and then silently shows the sample game to players.
4. **Desktop ☁ Publish / 📦 Deliver**
   - ☁ Publish needs the owner's **whole-bucket R2 write key** on the machine (`_ensure_r2_creds`). A second publisher needs the same key, and rotating it breaks everyone. Deliver needs only a portal login with `gamePublish`.
   - 🗜 Optimize re-encodes images as lossy WebP q80, which the engine measured on 09-23 as causing visible banding. The engine itself settled on `nearLossless: 40`.
   - **Deliveries carry no build identity** (no engine or game SHA, no lockfile) and can't be reproduced. The engine is advanced and the lockfile re-resolved on every build.
   - The launcher repo has no CI, and its README describes the old ComfyUI launcher.
5. **Delivery builds**
   - Built: profile + `config.json`, `?rgs_profile=`, `rgs.source: 'host'`, the embeddable `game.js`, `build-delivery.mjs` (EMBED.md, zip, partner `embed.html`, strips unused assets, refuses source files), the `serve-embed` preview, bet ladder and jurisdiction locks (#798).
   - **The "package-for-delivery mode" in `STATUS.md` roadmap #3 is not unbuilt.** It was deliberately built into `build-delivery.mjs`.
   - Genuinely open: see §5.3.
   - **No record exists of a delivery hosted on the partner's real CDN and embed page. (unverified)**
6. **KTX2 / optimization**
   - Verified live: 66.3 → 49.6 MB for the remake.
   - The KTX2 alignment, page-store and art-export-concurrency guards are not in CI. The fix itself lives in the encoder, so they only protect against a regression.
   - Encoding runs in the launcher process.
   - `KTX2_ENCODE` isn't in the INFRA env tables.
   - No real iPhone or Android pass has been recorded.
7. **Test server**
   - It is really **production demo hosting under a "test" name**. One in-memory instance reads everything from R2 before it starts listening.
   - **Every `/refresh` rebuilds all mocks, resetting every demo wallet** (a shared `sessionID=demo`) and dropping open rounds. Every publish and every release triggers one, which also defeats resume across a release.
   - The `/refresh` secret is optional and sent in the query string. Whether it's set is unverified.
   - The Dockerfile doesn't copy `lines.json`, so `linesGrid` is always `null` in production (minor).

---

## 4. Tool by tool

Sizes: **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks. Tags: **MUST** before operating · **SHOULD** · **COULD**. "Owner" means it needs the owner's eyes, credentials or a dashboard.

### 4.1 Asset generation (Python / cloud)

#### Invisible Atlas Maker — `services/atlas-tool`, `/atlas` — 🟡
- **Done:**
  - SDXL, FLUX and gpt_image generation on RunPod Serverless (owner-tested 08-18); slice, compose, deploy.
  - The R2 staging mirror reconciles deletes.
  - ⚙ "Run generation on: RunPod | My computer".
  - `pack`/`grid` layouts, trim, empty-compose and stale-rect/dropped-frame deploy guards.
  - `variant_at`, AI layers, ⧉ Duplicate atlas, the Region Overlay Inspector, 🏷 Taxonomy.
  - Submit-time guards for missing nodes, models and VAE family; remote cancel; the worker build sha on every error.
  - 30 of 32 offline suites pass. The two failures are environmental.
- **Open / risky:**
  - **One render slot for the whole service.** `_render_state`/`_render_proc` are module globals (`ui_server.py:290-294`), so one user's Stop kills another's render.
  - **The open atlas is project-shared** (`atlas_config.json` `manifest_path`, `ui_server.py:1580`). Per-user sessions (phases 2–3) are unbuilt.
  - **No `If-Match` on manifest saves**, so two users can overwrite each other.
  - A `grid` atlas is limited to one page, and `pack` has no page-size ceiling (a 1028×25652 page was measured). The `keep` trim default can make pages about 5× larger.
  - `ui_server.py` is 11.7k lines, with 101 commits since 08-15.
- **Verify owed:** frame guards (#684/#686), from-scratch auto-pack, the `.atlas` compose/slice smoke (open since May), grid, layout switch, the layout-aware panel, `keep` trim, `variant_at`, AI layers, Duplicate, `_shadow`, the Overlay Inspector, and a "My computer" render.
- **Finish:**
  - MUST S (owner): one scripted verification pass on a scratch project.
  - MUST S: make the render slot and Stop per-user, and show who is rendering.
  - SHOULD: freeze features this month.
  - SHOULD M: `If-Match` on manifests.
  - MUST/SHOULD L: per-user sessions, depending on how many artists work at once.
  - COULD M: multi-page grid and a `pack` page cap.

#### Invisible Blueprints (a feature of the Atlas Maker) — 🟡
- **Done:** all 8 phases, used live (processing blueprint 09-09). Model resolution against the R2 mirror **is built** (`model_mirror.py`, 126/126 tests). STATUS.md roadmap #2 is mis-sized.
- **Really unbuilt:**
  - *Delivery* of a mirrored model onto the target machine: the serverless worker has no R2 credentials and can't restart ComfyUI mid-job.
  - `/api/launcher/models-manifest` is admin-only.
  - `push-models.py` has never run against R2.
- **Finish:**
  - SHOULD M: a "stage this blueprint's models on the volume" action, or a runbook accepting manual staging.
  - SHOULD S: run `push-models` for `comic-style-lora`.
  - Owner: re-publish the imported video blueprint with a pod running.

#### Invisible Sheet Maker — `services/sheet-tool`, `/sheet` — 🟢
- Low churn (8 commits); suites green.
- **Open:** sheet saves have no `If-Match`.
- **Finish:**
  - MUST S (owner): one browser pass over the project-file workflow, FX picker, `.plist` import and lock.
  - COULD S: `If-Match` on save.

#### Invisible Font Maker — `/fonts` — 🟡 (close to 🟢)
- **Done:** View, Import (BMFont and web), Generate (kerning, multi-page, multi-stop gradient). The ship chain and the engine's missing-glyph guard are both built; the status file still says they're open.
- **Finish:** MUST S (owner): a browser pass, plus one font taken through publish into a real game.

#### ComfyUI generation backend — RunPod serverless + R&D pods — 🟡
- **Done:**
  - Cancel-aware serverless worker, conditional VRAM restart, build sha in logs.
  - One pinned `nodes.json` for both images; both images rebuilt green on 09-16.
  - `/comfyui` fleet panel with idle auto-stop, the node manager and ErrorRecall.
  - The local tunnel is **off** the production path, and fails fast with a readable message.
- **Open / risky:**
  - **The endpoint's image pin is unrecorded.** On 09-14 it was pinned to the pod image and "prod rendered nothing". The owner generated on 09-17, so it was probably fixed, but the tag is unknown. The 09-16 node changes only reach production once it's pinned to that build.
  - The handler timeout is 9,000 s (2.5 h) per job. The endpoint's real Execution Timeout is unrecorded. There is no per-user spend cap.
  - **R&D pods expose ComfyUI through the public RunPod proxy and TCP 8188 with no auth**, with Manager at security "middle". Anyone with the URL can queue work or install nodes on a billing GPU.
  - There is no render smoke test in CI; broken baked blueprints fail only at submit time.
- **Finish:**
  - MUST S (owner): pin the endpoint to `atlas-comfy-worker:<09-16 sha>`, then render one SDXL, one FLUX and one SemanticLayers job and record the result.
  - MUST S (owner): set the endpoint Execution Timeout and a RunPod spend limit, and document both.
  - MUST S: verify idle auto-stop live.
  - SHOULD S: a pod-exposure policy.
  - SHOULD S–M: a CI check of blueprints against the image's node classes.

### 4.2 Animation and VFX

#### Invisible Rigger — `/rigger` (`static/rigger/view.html`, 13k lines) — 🟡
- **Done:**
  - Bones, slots, skins, meshes (UV panel, edges, hull promote/demote), weights (bind, brush, per-vertex, auto-to-chain).
  - Dopesheet, graph editor, deform / draw-order / event / sequence tracks; IK, transform, path and physics constraints.
  - Rig and animation libraries in Postgres, localized text as art, FX/flipbook event bindings.
  - The rule-8 ship chain (owner-confirmed 08-04).
  - The spike suite passes locally: 153/153 rigs, 2,646 assertions. The pivot/anchor contract has settled (no commits since 09-24).
- **Open, verified in code:**
  - **The `.irig` save has no conflict protection.** `routes/api/rigger/save/+server.ts` does a plain `putObjectText`: no base ETag, no `If-Match`, no lease. It takes the project from the session, so a project switch in another tab writes the rig into the other project. It isn't even listed among the "13 authoring surfaces" in `multi-user-concurrency.md`.
  - **No undo for rig editing** (`view.html:10940`). No `beforeunload` guard, no `.irig` backup, and R2 versioning is off.
  - **Saving doesn't validate the document** (the server only checks `Array.isArray(bones)`). One structural error makes the rig unopenable in the only tool that can repair it.
  - Saving to the shared library overwrites studio-wide without a confirm (`view.html:2682`).
  - Auto-weights are proximity-only. Roadmap #1 (a heat/geodesic skinner) is genuinely unbuilt. 3.6d is unbuilt.
- **Verify owed:** the whole tool live against R2, pivot/anchor, sequences, localized rig text in a game, slot depth and overrides in a published game, the per-keyframe binding after a re-bake, and some hull/UV items.
- **Finish:**
  - MUST S–M: conditional `.irig` save (baseEtag + 409 UX, mirroring `cinematic.js`) plus a project scope guard.
  - MUST S: re-parse through the tolerant loader before saving, and keep a server-side rolling backup.
  - MUST S: `beforeunload` guard.
  - MUST M (owner): a scripted live pass.
  - SHOULD M: undo (lift the cinematic's snapshot history onto `rawDoc`).
  - SHOULD S: put the spike suite in CI and fix `roundtrip.mjs`'s hard-coded path.
  - SHOULD S: confirm before overwriting a shared-library rig.
  - Defer unless in-house character rigging is on the critical path: heat weights (L), 3.6d, the persistent FX slot.

#### Invisible Cinematic — 🎬 mode in `/rigger`, `packages/engine-cinematic` — 🟡
- **Done:** Phases 0–3 plus Tweak Mode. Saves with baseEtag, scope guard and undo/redo. Full ship chain; `<FlowV2Cinematics>` is mounted in `Game.svelte`. No feature churn since 08-19.
- **Risk:** **the in-game half has never run in a real game.** Its first production use will also be its first execution.
- **Finish:**
  - MUST M: author a cinematic, trigger it with a `playCinematic` node, publish, and watch it. Treat this as debugging.
  - MUST S: a live check of the server chain.
  - SHOULD S: put `sync-cinematic-eval --check` in CI.
  - COULD M: quick-add Text/FX.

#### Invisible Flipbook — `/flipbook` + 🎬 Video mode — 🟡 (clips 🟢)
- **Done:**
  - Build-plan steps 1–8; consumed by Symbols, the Scene Editor and Rigger events.
  - Clip reachability pruning is **done**, though the status file still says open.
  - Video generation has run on a real RunPod GPU, with container lease + CAS, sweeper, rescue, cancel, and "To Atlas Maker" (on `main`, not a branch).
- **Open:**
  - **BiRefNet weights aren't pre-fetched** (`fetch-models.py` has no RMBG entry). This already caused a 14-hour outage on 09-04.
  - Per the status doc, a non-expiry RunPod 404 settles the tile without cancelling the job, so it keeps billing.
  - Nothing prunes old `video/` sessions.
- **Finish:**
  - MUST S: pre-fetch the BiRefNet weights.
  - MUST S (owner): re-publish the video blueprint.
  - SHOULD S: re-check before settling a tile on a 404.
  - SHOULD S: one observed session covering RGBA cutout, a cold worker, the ~20 MB payload cap, pick → pack → clip, and To-Atlas end to end.

#### Invisible FX — `/fx` — 🟢
- **Done:**
  - All three particle tiers plus the event trigger; the pro inspector; layer ops and presets.
  - Rig-timeline binding through `<SpineProvider>`; preview speed matches the game.
  - Full ship chain with reachability pruning; CAS, lease, unsaved guard.
  - `tools/fx.md` **was already refreshed** on 08-28, so STATUS.md roadmap #4 is stale.
- **Open:**
  - **Manual Save force-overwrites** (`fx/+page.svelte:903`).
  - The Tier-C (spine-as-particle) performance ceiling is unmeasured.
  - `R_Wins` keys the same continuous effect on ten animations, so emitters stack and never stop.
- **Finish:**
  - MUST S: the force-save fix (with symbols and localization).
  - MUST S (owner): the Min/Max rows pass.
  - SHOULD S–M: measure Tier-C and add a pool cap or warning.
  - SHOULD S: warn when one continuous effect is keyed on several animations.

#### Invisible Spine Viewer — `/spine` — ✅
- Per-project skeleton indexing, both 4.1 and 4.2 runtimes, access-gated.
- **Only doc cleanup is left:** the hotfruits text in `tools/spine-viewer.md` and the stale open item in its status file.

### 4.3 Game authoring

**The force-save bug** is still present at exactly three sites. Four audits found it independently, and I checked it by hand:
- `symbols/+page.svelte:1790`
- `fx/+page.svelte:903`
- `localization/+page.svelte:364`

Each binds `onclick={save}`, so the click event arrives as the truthy `force` argument and the conflict check is skipped. The code comments above each button say so, and say "flagged for the owner". None of the three autosaves, so **every manual Save in these tools is a blind overwrite**. The lease mitigates this, but the lease fails open on network errors (`leaseState.svelte.ts:157`).

**Fix:** `onclick={() => save()}`, plus a source scan in CI so it can't come back. **MUST, well under a day.**

#### Invisible Scene Editor — `/editor` — 🟡 (the most solid of the four)
- **Done:**
  - Screens manager, layout spaces, always-on-top / behind-reels, per-layout overrides, authorable layout profiles.
  - Reel grid including perspective and stepped grids; blend modes (three runtime bugs fixed and pixel-verified); bet-menu and auto-spin screens.
  - Undo/redo, multi-select, snap, clipboard.
  - Autosave with conflict check + lease, and **rolling backups with restore** (the only tool that has them).
  - New screens *do* mount in the game. `status/editor.md` open item 1 is false.
- **Open / risky:**
  - The editor canvas is a separate Canvas2D drawing of the scene; the game uses Pixi `<LayoutScene>`. Six editor-vs-game mismatches have been fixed since 08-15.
  - **The save-time allow-list** (`normalizeScene`/`normalizeAlign`) silently drops any new field it doesn't list. This has happened at least four times, and only the perspective grid has a round-trip guard.
  - Three files of about 5k lines each.
- **Finish:**
  - MUST S (owner): a verification session on the ⏳ list (28 items).
  - SHOULD S–M: a schema-driven round-trip guard in CI (every field must survive `normalizeScene`).
  - COULD S–M: a "Preview in game" button.

#### Component Editor — `/components` — 🟢
- **Done:** tree authoring, params and signals, expose-as-param, button-state animations, pin-by-default versioning, promote to shared, the per-game defaults panel, the cross-project spine-reference heal.
- **Open:**
  - **No autosave:** drafts live only in memory.
  - The defaults file has never been written live.
  - The behaviour/timeline layer (§17) is not started.
- **Finish:**
  - MUST S: write one defaults file end to end (editor → publish → game).
  - SHOULD S: formally descope §17. Signal cues, `hiddenUntilSignal` and `playCinematic` already cover most of it.
  - COULD M: a local draft autosave.

#### Invisible Flow (v2) — `/flow-v2` — 🟡, **the highest-risk tool of the four**

As of today it holds the free-spin intro, outro and reveal rounds (#807, #810).

- **Done:**
  - Typed exec and data pins, live validation panel, deterministic preview, functions and groups.
  - Autosave + conflict check + lease.
  - `$engine` reads, HUD menus through the flow, hold-safety validators, a starter flow seeded per game type.
  - `bookofborutremake` runs on a v2 flow in production.
- **Open, verified in code:**
  - **No undo, and no backups.** A mistaken delete is autosaved and can't be recovered.
  - **Validation is advisory only.** The save API checks shape only. Neither `flowV2Export` nor `publishGame.ts` runs `validateFlowDoc`. A hold that nothing releases freezes the round forever in a live game, because the runtime has no hold timeout.
  - **Silent dead wires.** The editor lets several wires leave one exec pin, but the runtime follows only the first (`packages/engine-flow-v2/src/runtime.ts:255`, `.find`). The validator doesn't catch this, and the guide admits "nothing warns you".
  - **A project that never had its flow edited has no free-spin intro/outro since #807.** The scaffold writes no `flow-v2.json` (`projectScaffold.ts`); it is created on first edit.
  - **Older projects** whose scenes still bind the retired `FreeSpinIntro`/`FreeSpinOutro` composers now draw nothing and no longer pause the round. I couldn't check which live projects are affected (no R2 read).
  - Six flow-spike tests are red on `main`; that suite isn't in CI.
- **The v1 runtime is still load-bearing.** It builds the default loading leg, supplies `linesEngineReader` and feeds the `/fx` vocabulary. Freeze it and retire it next month (M–L); it isn't needed to operate.
- **Finish, in priority order:**
  - MUST S: seed `flow-v2.json` at project creation, or refuse/warn at publish.
  - MUST S: run `validateFlowDoc` at publish and refuse on errors (with a "publish anyway").
  - MUST S: an exec fan-out check (a validator error, or refuse the second wire).
  - MUST S: a read-only sweep of projects for composer binds, then migrate.
  - MUST M: flow doc backups (reuse `editorDocBackups`) plus an undo stack.
  - SHOULD M: get the six red flow-spikes green and add the suite to CI.

#### Symbols State Machine — `/symbols` — 🟠
- **Done:**
  - The rebinding grid (sprite, spine and flipbook cells), full ship chain, cell layers with blend modes.
  - Count-up and run-up, `winExplode`, `winBeat.maxMs`, `arrivalRelease`, explosion patterns, the clear-reel state, KTX2 symbols on phones.
- **Open:**
  - Force-save (above).
  - `symbolExport.ts:698` drops an unresolvable spine silently (`if (!result) return;`), so a renamed or deleted spine ships as nothing.
  - The preview endpoints are gated on the `editor` tool.
  - Book-VFX and transition layers have no blend control.
  - Stacked-art layers are ignored.
  - 43 commits since 08-15; 38 ⏳ markers open.
- **Verify owed:** **black-box symbols on the S24 and iPhone.** The fix needs a re-bake, a runtime release and a look on the failing devices. Also owner checks of explode, clear-reel, win beat, arrival release, count-up and highlight.
- **Finish:**
  - MUST S: the force-save fix.
  - MUST S: re-bake the remake and check it on the S24/iPhone.
  - MUST S: a `spinesMissing`-style report in `symbolExport`.
  - SHOULD M: symbols doc backups.
  - SHOULD S: tool-gate the preview endpoints; add the missing blend selects.

### 4.4 Game setup and content

#### Invisible Game Maker — `/game-maker` — 🟡
- **Done:**
  - Create with cloud scaffold, and Duplicate (`setup`/`full`).
  - Publish, capability-gated and access-checked (#811), with a CAS write of `games.json`.
  - Stale-engine badge plus bulk "Republish stale/all", catalogue filters, and an assemble that went from 93 s to 25.5 s and produces byte-identical output.
- **Open:**
  - Every boot runs all seven exporters (§3.2).
  - The bulk job's state lives in process memory.
  - **The user guide's "Known limitations"** (`docs/tools/game-maker.md:279-306`) tells a non-dev that non-lines kinds, per-game math and runtime localization don't work. All three do now.
- **Verify owed:**
  - The bulk republish UI.
  - The runtime-boot render and boot order.
  - Publish pinning the session to the published project.
  - Profile chips.
  - One `setup` and one `full` Duplicate against real R2.
- **Finish:**
  - MUST S: fix the guide.
  - MUST M: the Publish snapshot (§3.2).
  - SHOULD S: the verify pass.

#### Invisible Game Config — `/config`, `packages/game-config` — 🟡 (tool solid, math contract not)
- **Done:**
  - All 8 phases: grid, stepped grids, win model (lines/ways/cluster/scatter), cascade, reel behaviour, emerge, config-authored win tiers and bet modes.
  - The mock follows the config live, and the RGS owns the board size.
  - Boot-time grid and paytable cross-checks (#799), Import paytable (#806), project-scope 403 (#811).
- **Open, verified in code — the paytable problem:**
  - **The scatter pay row is hard-coded** as `[2, 20, 200]` (`apps/lines/src/game/paytable.ts:87-99`, `packages/game-config/src/serverPaytable.ts:139`). Any game whose scatter pays differently shows the wrong pays.
  - **Import reads only our own test server** (`lib/server/rgsConfig.ts`). Since #806 the mock pays whatever `/config` says, so on our stack the two agree *by construction*, and a wrongly authored table is invisible. Against Play4Fun the only guard is one `console.warn` at boot.
  - **No RTP readout.** `showTheoreticalPayback` → `displayRTP` is mapped, and nothing renders it.
  - Placeholder math everywhere else:
    - the ways default measures 0.13 % RTP against 0.97 declared;
    - the live `test5` measures 41,355 %;
    - bookOf and cluster have no config default.
  - **Unverified:** whether `services/test-server` has been redeployed so the book mock pays the authored table.
- **Finish:**
  - MUST S–M: make scatter pays authorable (a runtime release).
  - MUST S: "Import from a pasted Play4Fun `config` capture", reusing `readMappedPaytable`/`planPaytableImport`.
  - MUST S: make paytable drift a banner or a publish/deliver gate instead of a console line.
  - MUST M for regulated markets: RTP and max-win on the info page.
  - SHOULD S (owner): click through the panels added after the 08-04 pass.

#### Invisible Localization — `/localization` — 🟢
- **Done:**
  - Harvests every text source (scenes, win text, symbol names, flow messages, bet modes, coded UI) plus manual rows.
  - Masks "never translate" terms; two providers; per-cell and bulk review.
  - The runtime merge was fixed and verified live; only reviewed text ships.
- **Open:**
  - Force-save.
  - No reviewed-coverage count.
  - Declared languages ≠ shippable ones: fonts need the glyphs (a missing bitmap glyph can black-screen), RTL isn't handled, and there is no in-game language picker.
  - **Unverified:** whether production has a translation provider configured (the docs contradict themselves).
- **Finish:**
  - MUST S: the force-save fix.
  - MUST S (owner): confirm the provider env.
  - SHOULD S: per-language reviewed coverage, with a warning at publish.
  - SHOULD M: a glyph check against the project's fonts.

#### Invisible Win Text — `/win-text` — 🟢
- **Done:** W1–W9.
- **Open:** `COUNTS = [2, 3, 4, 5]` is hard-coded (`win-text/+page.svelte:41`), so copy for wider boards or count-based wins (`test5` pays from 9) can't be authored. Level aliases are hard-coded too. No glyph guard.
- **Finish:**
  - SHOULD S (owner): the verify pass (owed since July).
  - SHOULD S: derive counts from the config.
  - SHOULD S: a glyph guard.

#### Invisible Sound — `/sound` — 🟡
- **Done:** S1–S10. Library, presigned upload, 128 kbps transcode on export (live), a publish gate for unapproved or unlicensed sounds, usage index, and cue choices.
- **Open, verified in code:**
  - `apps/launcher-api/scripts/pull-project-assets.mjs:205-213` `GENERATED_SUBTREES` has **no `sounds`**. The status file says it was added; `git log -S` says it never was. Removed or renamed sounds linger in desktop and delivery builds.
  - A rename doesn't repoint the moments that play the sound.
  - `.wav` files skip the transcode.
  - There is no project audio budget.
- **Finish:**
  - MUST S (owner): the "choices" click-through (open, change a moment, save, reload, hear it in a game).
  - MUST S: add `sounds` to the prune list.
  - SHOULD S: a total-size warning.
  - SHOULD M: rename repoints its moments.

#### Invisible FTP Browser — `/files` — 🟡 (bordering 🟠)
- **Open:**
  - **Not browser-tested live since 06-02.** Uploads were capped at adapter-node's 512 KB until `BODY_SIZE_LIMIT` went to 32M on 09-17 (#730). That is about 3.5 months of broken uploads that nobody reported, which says the tool isn't used much yet.
  - The code's 200 MB cap is unreachable.
  - The docs describe the retired `<toolNs>/<client>/<project>` layout.
  - It is the source of the stored-XSS path (§2.1).
- **Finish:**
  - MUST S: fix the Content-Type (§2.1) and do a live pass.
  - SHOULD S: presigned uploads (the Sound pattern).
  - SHOULD S: fix the docs.

#### Storybook — `/storybook` — 🟢 (peripheral)
- Published manually. COULD: publish it from `runtime-release.yml`.
- `packages/game-spec` is **vestigial**: nothing imports it. COULD S: delete it.

### 4.5 Can a non-developer build a game end to end?

**For a lines, Book-of or ways reskin on the mock: mostly yes, with help.** The path is: create, then editor, atlas, symbols, config, sound, win text, localization, flow, then Publish.

What would trip a designer today:
- A new project with no stored flow has **no free-spin screens**.
- A second wire from an exec pin is **dead**.
- Wiring a fresh Game Signals pin switches off the game's coded handling of that moment.
- There is no undo in Flow or Rigger.
- The Game Maker guide says non-lines kinds don't work.
- Math has to be pasted from the provider.
- Real-money delivery happens outside these tools.

**The know-how gap is real.** The lead dev's personal Claude memory holds 261 files, including about 100 flow, editor and symbols gotchas, some of them author-facing. None of it is in the repo, and there is no cross-tool "build your first game" runbook.

**SHOULD, M:** write that runbook, and move the author-facing gotchas into the tool guides.

---

## 5. Engine runtime and games

### 5.1 Runtime core — `apps/lines` (the shared runtime bundle), `packages/engine-*` — 🟡
- **Done:**
  - The play pipeline was extracted into `engine-game` on a declared book-event contract (#802, live-verified).
  - Slam stop and the celebration lock, win count-up and tiers, resume presentation.
  - Jurisdiction locks and the server bet ladder (#798); the server-authoritative grid and bet menu.
  - KTX2 quality tiers, the delivery profile, and Flow v2 driving the remake.
- **Churn:** 197 engine commits since 08-15 (49 since 09-15), about 28 of them fixes. At least four regressions reached every online game (§3.2).
- **Open:**
  - **No release safety** (§3.2).
  - **No telemetry.** `PUBLIC_SENTRY_DSN` is declared in `packages/envs` and read nowhere, and there is no `onerror`/`unhandledrejection` reporter. A crash on a player's device is invisible to us.
  - `svelte-check` isn't in CI; `apps/lines` carries about 190 known type errors.
  - A big-win count-up that plays before its tap can still be slammed on a game with no `bigWin` screen.
- **Verify owed, urgent:**
  - **#807 + #810 on the live remake and test2–6.** #807 removed the coded intro/outro gates, and nothing records a check of any published game since. Look at the intro and outro drawing, holding, and taking a two-stage tap.
  - **KTX2 on a real iPhone and a ≤4 GB Android** (the design doc's rollout step 3). This is also the symbols black-box check.
- **Finish:**
  - MUST S: the #807/#810 live check plus the composer migration.
  - MUST S: `.svelte` support in `check-undefined-names`.
  - MUST M: gated and versioned releases (§3.2).
  - MUST M: a headless boot-and-spin smoke test before publish. It can reuse the real-clock harness `scripts/playtest/win-countup-repro.mjs` (#809).
  - MUST M: a client error beacon (`onerror`, unhandled rejections and RGS failures, tagged with the runtime commit and game key), or Sentry.
  - MUST S–M: a device pass (a 20-minute session with `?memhud=1`).
  - SHOULD M: `svelte-check` in CI as a ratchet on the error count (12 GB heap).

### 5.2 Game types

| Type | Verdict | State |
|---|---|---|
| **lines** | 🟢 | The shared runtime. The mock pays each project's own paytable. The bundled template quotes placeholder prices, so it always warns locally. |
| **bookOf** | 🟢 on the mock · 🟡 against the partner | The live remake: free spins, expanding symbol, buy, resume and paytable parity, all verified on the mock. **A partner delivery has never been played end to end**; only packaging and the wire were proven. #807 needs a re-check. |
| **ways** | 🟡 | Win model, per-way pricing, anticipation, template, vocabulary and filled layout; `check:ways` runs in CI; the owner has played `test6`. **No math export:** the strips are cosmetic. No real-RGS ways game. |
| **cluster** | 🟠 | The cascade is in the shared runtime and the mock evaluates it. **The wire (`tumbleStep`) is our own invention**; the partner's vocabulary has no cascade. No template, no config default. |
| **scatter** | 🟠 | Cluster plus multiplier collect. Has a config default. The `multiplierCollect` wire is also invented. The collect beat hasn't been browser-verified with real `M` art. |

**Advice:** position cluster and scatter as **not operable against Play4Fun** until the partner agrees a cascade wire (L, and theirs to give). Ways needs real math from the math provider.

### 5.3 RGS / Play4Fun integration — `packages/rgs-translator-eagaming` — 🟡
- **Done:** `seq` as a position, two-pass event handling, the server bet ladder and locks, the server-built bet menu, the paytable cross-check warning, resume of an open no-input round (live on the mock), `rgs.source: 'host'` and the partner embed page.
- **Open:**
  - **No transport resilience.** `eagamingFetcher.ts:57-75` takes the `seq` position *before* `fetch`, with no timeout, no retry and no reconnect UI. The partner's own client resends every second with a 30 s timeout. A hung socket hangs the spin, and a failed request burns its position.
  - **Not implemented:** gamble, the pick UI and resume across player input, free rounds, `batchengine`, history. `requestReplay` throws (`engineFacade.ts:1618`).
  - **About 20 operator settings we ignore or answer ourselves:**
    - min/max bet (units unconfirmed)
    - currency symbol, format and lock; locale
    - autoplay disabled and spin counts; **`minSpinDuration`**
    - `home`
    - **clock / elapsed time**
    - `confirmGameRoundStart`, `showCreditValue`, `showBetRanges`, `errorPanel`
    - history URL
    - **RTP displays**

    Several of these are **regulator-mandated** in common jurisdictions.
  - One live round in four sent no `collect`, still unexplained (`play4fun-protocol.md:277-287`).
- **Verify owed:**
  - Replay-not-recharge on the partner node.
  - Whether `PARTNER_RGS` is set on Railway.
  - Partner questions Q3 (their CSP `connect-src`) and Q6 (does the RGS bind a session to the operator that minted it).
- **Finish:**
  - MUST M, before any partner delivery: a timeout plus resend at the **same** `seq`, taking the position only on a response, plus a reconnect overlay.
  - MUST S: run the partner-node resume check and settle the missing `collect`.
  - MUST M–L for the first target jurisdiction, in this order: RTP readout, `minSpinDuration`, autoplay limits, currency format, clock/elapsed time, `home`, then min/max bet once the units are confirmed.
  - SHOULD M: history/replay, for certification and support.
  - Defer: gamble, picks, free rounds (L).

### 5.4 QA, playtest and CI coverage — 🟠
- **What CI runs** (`lint.yml`, and it isn't required):
  - ESLint against a baseline (281 suppressed violations)
  - `check:undefined-names` (`.ts` only)
  - the flow-vocabulary codegen check
  - `check:rgs` (7 scripts)
  - `check:engine-game` (3 fixtures)
  - the launcher's `check:launcher-gates` and `check:project-scope`
- **What exists and passes locally, but CI never runs:**
  - about 27 `verify-*` scripts
  - 26 of the 29 engine `*.fixture.ts` files
  - 17 of the 19 launcher `check:*` scripts
  - **all 38 Python test files** (2,000+ assertions)
  - the rigger-spike suite (153 rigs) and the cinematic eval-sync check
  - `game-config-spike`, `check:sound-bindings`, the paytable verifiers
  - the KTX2 and page-store guards
- **What doesn't exist at all:**
  - **Playwright E2E**: `turbo.json` declares `e2e`, but no package defines it. CLAUDE.md still lists Playwright and Chromatic.
  - Any `vite build` before merge.
  - `svelte-check`.
- The Playtester is Phase 1 only (agent-driven). Its status file hasn't been updated since 07-30.
- **Finish:**
  - MUST M: the boot-and-spin smoke test (§5.1).
  - SHOULD S: **one discovery runner** for every `*.fixture.ts` plus the pure-node `verify-*`/`check-*` scripts. The ones that could be run pass, so this is cheap and turns roughly 3,000 local assertions into a gate.
  - SHOULD S: a pytest job.
  - SHOULD S: fix or delete the six red flow-spikes and engine-layout's red `test-engine-owned-only`.
  - COULD L: Playtester Phase 2.

---

## 6. Launcher platform

- **Auth and roles:** 🟢.
  - scrypt with a timing-safe compare; hashed session tokens; httpOnly + secure + SameSite=lax cookies.
  - A Postgres-backed login throttle.
  - Three-layer tool access plus five capabilities; all 44 admin actions call `requireAdmin`; last-admin and self-demotion guards.
  - 125 endpoints, every one auth- or token-checked except the four intentionally open (`health`, launcher `download`/`latest`/`login`). Probes confirm 401/303.
  - The gaps are in §2.1 and §2.1.
- **Multi-user concurrency:** 🟢.
  - SaveState + LeaseState on 10 pages, and `writeGuard.ts` base-ETag checks.
  - **Exceptions:** the three force-save sites, the Rigger `.irig` (§4.2), Atlas/Sheet manifests (§4.1), and Rigger shared-library saves.
  - The two-browser verification per tool (Phase 4) is still owed. The design doc's header says it was done; §2a of the same doc says it wasn't.
- **Docs coverage (rule 9):** ✅. All 21 `TOOLS` ids have a slug, a guide, a README row and a resolving `/docs/<slug>` link. No real duplicates.
- **Desktop Invisible Launcher:** 🟡.
  - Separate private repo, v1.0.55, served from R2 via open routes. Unsigned exe.
  - Its registry description still says it "installs ComfyUI + starts the tunnel". Its main job is now publish and deliver.
  - See §3.2 and §2.1.
- **Operational:**
  - Migrations: 20 files (0000–0019), applied on boot. **A failed migration only logs and continues** (`db/migrate.ts:153-157`), and `/api/health` always returns `{ok:true}` without touching the DB.
  - No `handleError` hook, no error tracking.
  - Build settings live only in the Railway dashboard (no `railway.json`).
  - The launcher has **no watch paths**, so every push redeploys it. That's 23 today and 315 in 30 days, each with the ~104 s no-healthcheck gap.
- **Finish:**
  - SHOULD S: make `/api/health` check the DB and the migration state, and fail the boot on a failed migration.
  - SHOULD S: watch paths for the launcher.
  - SHOULD M: put the launcher build and the full `check:*` suite in CI.

---

## 7. Infrastructure and operations

### 7.1 Inventory — 🟡

| Service | Deploys | Live check |
|---|---|---|
| Launcher (`app.invisiblewall.org`) | Railpack, auto on **every** push, no watch paths | `/api/health` 200 |
| atlas-tool, sheet-tool | Dockerfile, watch paths | 403 (secret gates on) |
| **atlas-backend** | Dockerfile, watch paths | **200, no auth, should not exist** (§2.1) |
| test-server (`games.invisiblewall.org`) | Dockerfile, watch paths | 200. Served directly from Railway: no Cloudflare in front, so no WAF or edge cache. |
| Postgres | Railway, **public TCP proxy** | not probed |
| Cloudflare | DNS-only CNAMEs; `comfy` tunnel behind Access | tunnel 403 without a token |
| R2 `invisibleassets` | one bucket, **one master key** | — |
| RunPod | serverless endpoint (production) + R&D pods + a Network Volume | — |
| GitHub Actions | `lint.yml`, `runtime-release.yml` (99/100 green), two GHCR image builds | — |

**Single points of failure:**
- the **launcher**: every online boot goes through it;
- the **test server**: all online games in one container's memory;
- **R2**: one bucket, one key;
- **one person**: all 315 commits in the last 30 days, the sole CODEOWNER, and the holder of every dashboard.

**Still tied to a person's desktop:** desktop/delivery builds, the model seed scripts, and "My computer" generation. Production generation is not.

### 7.2 Backups and disaster recovery — 🔴
- **Have:**
  - Scene Editor doc backups (`editorDocBackups.ts`).
  - Project soft-delete with an explicit purge.
  - Migrations on boot.
  - The video runner re-attaches after a container swap.
- **Don't have:**
  - **R2 object versioning** (the repo's own fixture says so).
  - Backups for flow, config, symbols, rig and localization docs.
  - **Any Postgres backup or restore procedure in the repo.** Railway backups may exist on the plan **(unverified)**.
  - Runtime version history.
  - Split R2 credentials: one leaked key gives full read, write and delete on every live game.
- **Finish:**
  - MUST M: a nightly `pg_dump` to a second store (a GitHub Action or Railway backups), plus **one restore drill**.
  - MUST M: a nightly sync of R2 `<client>/<project>/` to a second bucket or account, with retention. Or turn on R2 versioning, if the cost is acceptable.
  - MUST S: fix the rotation consumer list, then rotate (§2.1).
  - SHOULD M: split R2 tokens per consumer: read-only for the test server, one for CI, one for desktops.

### 7.3 Monitoring and alerting — 🔴
- **Have:** health endpoints (the launcher's, test-server `/healthz`), an Admin → Costs page (pull-only), and deploy state readable via commit statuses.
- **Don't have:**
  - Error tracking anywhere (launcher server, game client, Python tools).
  - Uptime checks.
  - Alerts on a failed release. The release warns and exits 0.
  - Spend alerts.
  - A health path on atlas-tool/sheet-tool that the auth gate doesn't block.
- **Finish:**
  - MUST S: an external uptime monitor on app, games and atlas-tool, after adding a gate-exempt `/healthz` to atlas-tool.
  - MUST S: fail the release on a served-hash mismatch (§3.2).
  - SHOULD M: Sentry or similar across all three.

### 7.4 CI and repo hygiene — 🟡
- **Branch protection on `main`: none** (the protection API returns 404; rulesets are `[]`). The `lint.yml` note that protection needs a paid plan is **wrong while the repo is public**. MUST S: require Lint, block force-push.
- Commit-scope and secret hooks are client-side only; PR titles aren't scope-checked. COULD S.
- Open PRs: 1 (#786). 43 remote branches, many stale. 48 worktree directories. COULD S: prune.
- Python requirements have floors only and no lockfile. CI uses a floating Node `22`. SHOULD S: pin both.

### 7.5 Cost exposure — 🟡
- **RunPod:**
  - Pods keep billing while any open tab heartbeats.
  - Jobs can run up to 2.5 h.
  - Cancel only stops the GPU if `RUNPOD_*` is set on the endpoint **(unverified)**.
  - No spend limit is recorded.
- **Railway:** usage-based, with 10–23 launcher rebuilds a day, and the launcher has run out of memory on bakes.
- **LLM translation:** no cap in code.
- **R2:** no egress fees. The cost is storage (about 370 MB of orphaned prefixes) and request operations.
- SHOULD S (owner): a RunPod balance alert (or turn off auto-recharge), a Railway usage limit, and LLM monthly limits.

---

## 8. Cross-cutting themes

1. **Two ungated paths into production.**
   - A **merge** deploys to every online game with no checks.
   - A **save** deploys too, because online games boot from live authoring data.

   Both are fixed by the same idea: **snapshot, then promote.** Versioned runtime releases with a pointer, and a frozen bundle per Publish.
2. **No safety net for data.** Only the Scene Editor can undo *and* restore a previous version. Flow and Rigger can do neither. R2 and Postgres have no documented backups. That's fine for one careful person; it isn't fine for a team.
3. **The verification debt is larger than the build debt.**
   - About 80 ⏳ items in four tools, plus dozens elsewhere.
   - Harnesses with thousands of assertions that only run when someone remembers.
   - Status files with long "Was:" chains.

   **Most "done" features are code-complete but not confirmed in a real game.** A structured verification sweep (§9, week 3) is the single highest-value use of the owner's time this month.
4. **Everything runs through one person.** All the commits, CODEOWNERS, every dashboard, the only R2 key that can publish, and 261 memory files of gotchas that aren't in the repo. Gate E (§9) is about fixing that before the team grows.
5. **The docs are accurate about features and stale about state, in both directions.** Some items called unbuilt are built: Blueprint model resolution, the delivery package mode, the tools/fx refresh, the font ship chain, flipbook reachability, and scaffold install paths. Some called done aren't: sounds in the prune list, the Rigger's concurrency. Also "private repo", "dormant atlas-backend", and "release is manual dispatch". [Appendix B](#appendix-b--doc-drift-found-for-docs-keeper) lists the corrections for `docs-keeper`.
6. **Churn is the enemy of "solid".** Three sessions edited `auto_pack_layout` on one day, the Rigger pivot was redesigned three times in one day, and 23 launcher deploys happened today. A freeze is the precondition for everything else here.

---

## 9. Recommended plan for the last heavy month

**Rule for the month: feature freeze.** Only work that closes a gate below gets merged. Anything else waits for October, unless it fixes a bug that the verification sweep finds.

At the last 30 days' pace (about 10 merged PRs a day with agent help), the MUST list is achievable. It is roughly 45 items, about 60 % of them S. But it is **only** achievable if new features stop.

### Week 1 — Gate A: "safe to leave running" (security) + Gate B quick wins
- [x] Delete `atlas-backend` (done 2026-09-30, verified). *(owner, S)* — no CF Access token rotation (owner decision).
- [ ] Repo visibility decision; secret scanning + push protection; scanner patterns; a history scan. *(owner + S)*
- [ ] Gate `git-credentials`; confirm the token is read-only and repo-scoped. *(S)*
- [ ] Re-check project access in `toolScope.gate`; `/api/lease` access and tool check; duplicate/create destination check; `deploy/f` client check; `partner-session` check. *(S each)*
- [ ] `adminPanel` can't promote to admin; `resetPassword` revokes sessions; redact `app_settings`. *(S)*
- [ ] Uploads: `nosniff` + `attachment` for HTML/SVG/unknown types; baseline security headers. *(S–M)*
- [ ] `ADDRESS_HEADER`/`XFF_DEPTH` defaults in `start.mjs`. *(S)*
- [ ] Portal relay as the default desktop publish route (unblocks the R2 rotation). *(S)*
- [ ] Then rotate R2, Postgres, `COMFY_ORG_API_KEY` and `EDITOR_DOC_SECRET`; close the Postgres public proxy; require org 2FA. *(owner, S)*
- [ ] **Force-save fix** in symbols, fx and localization, plus a CI scan. *(S)*
- [ ] **Look at the live remake's free spins after #807/#810**; sweep and migrate composer binds. *(S)*
- [ ] Launcher healthcheck `/api/health`; branch protection requiring Lint. *(owner, S)*
- [ ] Start the model licence audit. *(M, needs owner/legal)*

### Week 2 — Gate C: "a merge or publish can't silently break live games" + Gate B data safety
- [ ] Gates inside `runtime-release.yml` (undefined-names with `.svelte`, engine-game, rgs, a build) and a **red** job on served-hash mismatch. *(S)*
- [ ] Versioned `_runtime/lines@<sha>` + pointer + a rollback dispatch (+ optional canary). *(M)*
- [ ] A frozen runtime snapshot at Publish; player URLs read the snapshot, authoring stays live. *(M)*
- [ ] Headless boot-and-spin smoke in the release. *(M)*
- [ ] Client error beacon or Sentry (game + launcher). External uptime monitor. *(M + S)*
- [ ] Nightly Postgres dump + R2 project sync, plus **one restore drill**. *(M + M)*
- [ ] Flow: seed at creation, validate at publish, fan-out check, backups + undo. *(S×3 + M)*
- [ ] Rigger: conditional `.irig` save + scope guard, validate before saving, rolling backup, `beforeunload`. *(M)*
- [ ] Symbols `spinesMissing` report; `sounds` in the prune list; boot splash on the bake path. *(S×3)*
- [ ] Atlas: render slot and Stop per-user; signed Atlas/Sheet handoff. *(S + M)*

### Week 3 — the verification sweep (owner-heavy) + Gate D preparation
Run it as scripted, one tool at a time, on a scratch project. Record each ⏳ as closed or reopened in the tool's status file. Suggested order, following production risk:
- [ ] Flow (the #807 holds, the two-stage tap, starter flow, validators)
- [ ] Symbols on the S24 and iPhone, plus a **KTX2 device pass**
- [ ] Cinematic (first real-game run)
- [ ] Rigger live pass
- [ ] Game Config panels
- [ ] Scene Editor ⏳ list
- [ ] Component defaults end to end
- [ ] Sound choices
- [ ] Atlas / Sheet / Font passes
- [ ] FX Min/Max
- [ ] FTP
- [ ] Win Text
- [ ] Game Maker bulk republish and Duplicate
- [ ] RunPod: pin the endpoint to the 09-16 worker; SDXL, FLUX and SemanticLayers renders; Execution Timeout and spend limit; idle auto-stop; BiRefNet pre-fetch. *(owner + S)*
- [ ] Wire the existing harnesses into CI with one discovery runner, plus a pytest job. *(S–M)*
- [ ] RGS transport: timeout + resend at the same `seq` + reconnect overlay. *(M)*
- [ ] Paytable: authorable scatter, import from a pasted Play4Fun capture, drift as a gate. *(S–M)*

### Week 4 — Gate D: "first real-money delivery" + Gate E: "not dependent on one person"
- [ ] ~~Regulated settings for the first target jurisdiction~~ → **Owner decision (2026-09-30): any game can ship under any jurisdiction, so there is no per-market logic.** Honour **every** operator-declared host setting, with neutral defaults when a setting is absent: RTP (incl. buy/high-chance), `minSpinDuration`, autoplay limits/disable, bet clamps, clock/elapsed time, `home`, currency/locale, `confirmGameRoundStart`, history, and the rest. The mock can declare them all. Task queued: "Honour every operator host setting". *(L)*
- [ ] Build provenance stamp on every delivery; Optimize encoder fixed to `nearLossless: 40`. *(S×2)*
- [ ] Partner resume check + the missing `collect`; answers to Q3/Q6; **a full handover rehearsal on partner staging** with a checklist. *(S×2)*
- [ ] Runbooks, in the repo:
  - "build your first game" (cross-tool, with the author-facing gotchas from personal memory);
  - "publish and deliver";
  - "release and roll back";
  - "restore from backup";
  - "rotate a secret".

  *(M)*
- [ ] Access: a second admin on Railway, Cloudflare, RunPod and GitHub; grant `gamePublish` to developer and pipelineTester; `gamePublish` via the portal relay, not the owner's R2 key. *(owner, S)*
- [ ] A `docs-keeper` pass over Appendix B; update `docs/STATUS.md` roadmap and blockers. *(S–M)*

### Explicitly defer to after go-live
- Rigger heat/geodesic auto-weights and 3.6d; persistent FX/rig slots; FX renderer unification.
- Component behaviour layer (§17): descope it formally.
- Cluster/scatter templates and a partner cascade wire; gamble, picks and free rounds.
- Retiring the v1 flow runtime.
- Playtester Phase 2.
- Atlas per-user sessions phases 2–3, unless several artists will work at once. If they will, promote it to MUST (L).
- Multi-page grid atlases; Blueprint model staging on volumes.
- Authenticode signing; a CDN for `deploy/`; the Svelte/drizzle upgrade (unless an advisory is exploitable).

---

## Appendix A — Owner to confirm (dashboard-only facts)

- [ ] Was the engine repo made public on purpose?
- [ ] Are `CF_ACCESS_*` / R2 vars set on `atlas-backend`? (Moot if you delete it.)
- [ ] Is the launcher Health Check Path set?
- [ ] Railway plan: Postgres backups enabled? Is the Postgres public TCP proxy needed?
- [ ] Is `/data` a persistent volume on atlas-tool and sheet-tool?
- [ ] Which image is the serverless endpoint pinned to? What is its Execution Timeout? Is `RUNPOD_*` env set on the endpoint (so Cancel really stops the GPU)?
- [ ] RunPod auto-recharge and spend limit; Railway usage limit; LLM monthly limits.
- [ ] Are `TEST_SERVER_SECRET`, `ADDRESS_HEADER`/`XFF_DEPTH`, `PARTNER_RGS` and `KTX2_ENCODE` set?
- [ ] Has `services/test-server` been redeployed since #806 (so the book mock pays the authored table)?
- [ ] Is a translation provider configured in production?
- [ ] What is the scope of `GIT_CLONE_TOKEN` — read-only? Which repos?
- [ ] Which secret rotations are already done?
- [ ] Who else has admin on Railway, Cloudflare, RunPod and GitHub? Is org 2FA required?
- [ ] Have migrations through `0019` applied cleanly? (A failure only logs.)
- [ ] Which jurisdiction is the first target? This decides which of the ~20 host settings are MUST.

## Appendix B — Doc drift found (for `docs-keeper`)

**Global / cross-cutting**
- `docs/STATUS.md`:
  - Roadmap #2 (Blueprint `r2_key`): resolution is built; only *delivery* is missing.
  - Roadmap #3: the package-for-delivery mode is built in `build-delivery.mjs`.
  - Roadmap #4: `tools/fx.md` has already been refreshed.
  - Line 189 says "migrations through 0014"; there are 20.
  - Cinematic "engine half never ran": still true, keep it.
  - Delivery-builds bullet "Phases 2–3 unbuilt": stale.
- `CLAUDE.md` tech stack lists Playwright E2E, Chromatic and `pnpm e2e`. None of them exist.
- "Repo is PRIVATE" in the five files listed in §2.1.
- `lint.yml` says branch protection needs a paid plan; not true while the repo is public.

**Engine / flow**
- `engine.md:32`, the `engine-pixi-svelte` agent and `flow.md` say "the runtime ships by manual dispatch, NOT a main merge". It is automatic on push.
- `engine.md:16,19,26` mark as unmerged things that are on `main`: HUD Phase 2/2b, `cardParams`, `buyFeatureSceneId`, `activeBigTiers`/`codedTierFx`.
- `engine.md` open items 0.1, 3 and 7 are stale.
- `game-type-templates.md` "What Phase D still owes"; `perspective-board-mode.md:3` "PROPOSED"; `free-spin-intro-symbol-reveal.md:3` "built on branch"; `flow-driven-game.md:183` "no shipped game runs a FlowDoc". All stale.
- `flow.md` item 9: cue-await *is* authorable (`NodeInspector.svelte:150`).
- `invisible-flow-v2.md` §9 "strawman — not started" and §8.5 "loops open": stale.
- `flow-driven-game.md` §11 is planned against the retired v1 editor.
- `playtester.md` hasn't been updated since 07-30.

**Authoring tools**
- `editor.md`:
  - Open item 1 is false; new screens do mount.
  - `symbolSizeRatios` no longer exists; it's also still in `tools/invisible-editor.md:543` and `symbols.md:604`.
  - Version history is undocumented.
  - "Blocked: set `EDITOR_DOC_SECRET`": now it's "rotate".
- `editor.md`, `symbols.md`, `rigger.md` headers say "no agent"; the agent files exist.
- `rigger.md` one-line state is a ~1,500-word "Was:" chain. `design/invisible-rigger.md` §0 and §9 are stale. `tools/rigger.md` says auto-weights aren't built; they are, proximity-only.
- `cinematic.md` item 2: "no svelte-check" is stale.
- `flipbook.md`:
  - Item 3 (reachability) and line 223 are stale.
  - "To Atlas Maker on a branch": it's merged.
  - "Video not verified on GPU" contradicts item 1.
- `spine-viewer.md` and `tools/spine-viewer.md`: hotfruits text.

**Setup tools**
- `game-maker.md`: one-line state; "publish admin-only"; items 2, 4 and 5 stale. `tools/game-maker.md:279-306` limitations are stale.
- `game-config.md`: "✅ live-verified" covers work only up to 08-04; the "Sounds panel" section is obsolete; "grid hard-coded" is stale.
- `localization.md`: the role list is missing `pipelineTester`/`localizationReviewer`; bulk review isn't mentioned; "Blocked: no provider" contradicts the 08-15 entry.
- `sound.md:104,651`: claims `sounds` was added to the prune list. It wasn't.
- `ftp-browser.md` and `tools/ftp-browser.md:25`: old `<toolNs>/…` layout.

**Asset tools / infra**
- `infra.md`: "HIGHEST PRIORITY set tool secrets" is half done (gates on); atlas-backend isn't "dormant"; item 3 migrations are stale; "egress" should read "request operations".
- `comfyui.md`: 09-16 "neither image rebuilt" (both built green); item 12 "nothing ran live"; item 5 "v0.33.1 unproven".
- `atlas-maker.md` and STATUS: Blueprints "live-verify owed" is stale for picking, running and publishing. Item 6 (tool gates) is done.
- `font-maker.md` item 3 and the Blocked "engine guard TODO": both built.
- `sheet-maker.md` and `tools/sheet-maker.md`: "restart Atlas Maker" is no longer needed.
- `.claude/agents/atlas-python-tools.md:25`: gpt_image and FLUX listed as blocked (resolved 08-18).

**INFRA and launcher**
- `INFRA.md`:
  - The diagram predates RunPod and is missing sheet-tool, test-server, serverless and GHCR.
  - It contradicts itself on the Railway project structure.
  - The R2 rotation table lists 3 of 8 consumers.
  - The CF cache-purge section assumes Cloudflare sits in front of `games` (it doesn't).
  - `KTX2_ENCODE` is missing from the env tables.
- `.claude/agents/infra-railway.md`: lists 3 services, and tells agents to update `docs/STATUS.md` (contradicts rule 6).
- `launcher.md` items 1–3: stale (install paths are persisted, guides are linked, one `allowedPrefixes()`).
- `tools/launcher.md`:
  - Says audio has "no dedicated tool" and omits Sound from the artist and pipelineTester lists.
  - "Build type-checks": it doesn't.
  - `RESEND_API_KEY` is unused.
  - The Known-limitations entries B3/B5/B6 are stale.
- Design headers: `unified-project-repo` "proposal", `r2-client-isolation-and-scaffold` "proposal" and `unified-tool-bar` "Phase 1 in progress" are all shipped.
- `multi-user-concurrency.md`: the header says owner-verified; §2a says owed.
- `.claude/agents/launcher-studio.md` / `apps/launcher-api/CLAUDE.md`: "build = type-check", "ESLint misconfigured", and `db:push` listed (banned on prod).
- The desktop launcher's registry description and README still describe the ComfyUI tunnel launcher.

**Publish / games**
- `games-deploy.md` §"Which engine a build gets", the README that `new-game.mjs` generates, `publish-game-bundle.mjs`'s header and `tools/test-server.md:96`: they still prescribe `bump-game-engine.mjs` or describe the retired Book of Borut standalone repo. This conflicts with the no-submodule-bump rule.
- `live-assets.md` §"Cache-bust" says the stable-name case is "deferred".
- `gpu-compressed-textures.md` contradicts itself on downscale and mipmaps.

## Appendix C — What the audits ran

| Check | Result |
|---|---|
| Rigger spike `sequence-all.mjs` / `pivot.mjs` / `stretch.mjs` | 153/153 rigs, 2,646 assertions · 20 · 701 — all pass |
| `sync-cinematic-eval.mjs --check` | in sync |
| atlas-tool Python suites | 30/32 pass (2 fail on environment: no ComfyUI, missing PyYAML locally) |
| sheet-tool / atlas-serverless handler | 3/3 · pass |
| `check:engine-game` + 12 engine `verify-*` / `check-*` guards | all pass |
| Facade fixtures that import workspace packages | not run (no install in the worktree) |
| Live probes (status codes only) | launcher `/api/health` 200; authed routes 401/303; atlas-tool and sheet-tool 403; **atlas-backend 200 unauthenticated**; `/debug/access` 404; test-server 200 |
| `gh api` repo settings | **public**, secret scanning / push protection / Dependabot off, no branch protection |
| `pnpm audit --prod` | 0 critical, 60 high, 58 moderate |
| Hand re-checks of the headline findings | the security findings · force-save × 3 · flow exec `.find` · `.irig` save has no ETag — all confirmed |
