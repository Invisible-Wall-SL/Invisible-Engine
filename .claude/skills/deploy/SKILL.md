---
name: deploy
description: Deploy checklist for this monorepo's Railway services (launcher, atlas-tool, sheet-tool, test-server, director-worker). Use when the user wants to ship/deploy a change, or asks why a deploy "isn't working". Encodes the hard-won gotchas (always push, staged env vars, verify the runtime).
---

# Deploy

Railway auto-deploys each service from GitHub `main` on push. There is no manual deploy step — **pushing to `main` IS the deploy**. The mistakes that waste time are always the same; this checklist prevents them.

## Procedure

1. **Build locally first** (catch errors before they reach Railway):
   - Node service (launcher): `pnpm --filter launcher-api build`
   - Python service (`atlas-tool`/`sheet-tool`): `py -m py_compile services/<svc>/*.py`
2. **Commit** with a concise imperative message. End with the Co-Authored-By line.
3. **Push** — `git push origin HEAD`. ⚠️ This is the step most often forgotten. A commit that isn't pushed does NOT deploy. After pushing, confirm with `git log origin/main..HEAD --oneline` (should be empty).
4. **Verify the running service actually picked up the change** — do not assume. Poll the live URL until it reflects the new code (e.g. a new route returns 200/401 instead of 404, or a changed response appears). Service URLs are in `docs/INFRA.md`.

## Env var changes (the #1 source of "it deployed but didn't work")

- On Railway, **adding/editing a variable only STAGES it**. You must click the **"Apply changes / Deploy"** banner at the top. A plain "Redeploy" of an old deployment does **NOT** apply staged variables.
- For **non-secret** config (URLs, flags), prefer a **code default** (see `apps/launcher-api/src/lib/server/env.ts`) so a deploy never depends on the dashboard being right.
- When a var "isn't working" after the user says they set it + redeployed: **don't keep telling them to re-check the dashboard.** Verify what the runtime actually sees — temporarily expose a no-secret diagnostic (e.g. a public `+server.ts` returning `{ configured: boolean, RAILWAY_SERVICE_NAME }`), hit it on the live URL, then remove it.

## Service-specific notes

- **Launcher** (`Invisible launcher` project): serves `app.invisiblewall.org`. Has Postgres. Routes under `(app)/` require auth+role.
- **director-worker** (Invisible Director): no public domain — verify from the deploy log (`"msg":"agents loaded"`, `"msg":"sweep"`) and its commit status, not a URL. Build check: `pnpm --filter director-worker build` (a typecheck; the image runs the TS directly). It reads the launcher's Postgres but owns no migrations, so a push with a Director migration can bring the worker up before the launcher has migrated — `/healthz` goes 503 until it has; redeploy the worker if it stays stuck. Set-up and env: `docs/INFRA.md` § "Invisible Director worker". **Before a worker build that changes agents' tools** (e.g. ADR-0008 card 8D: the narrowed `atlas-artist` definition, which drops `queue_variants`): run `DATABASE_URL=<prod> pnpm --filter director-worker check:idle --pause` — it pauses running runs (with an Activity note to the owner) and exits 0 only when nothing is running or stopping; deploy only then. **ADR-0008 card 8C (the Preset removal) is stricter:** run `check:idle --strict` from the 8C build — it exits 0 only when no started run is unended (waiting and paused count) and no draft still holds a pre-8C preset; those are their owner's to finish, stop or delete first (card 8F removes the preset-draft list, so don't run the 8C check from a later checkout). **Card 8F (migration `0030`, drops `director_runs.preset_json`) deploys only once BOTH the launcher and director-worker deploys are at or after 8C** (a pre-8C worker reads the column in `withLease`, so every drive would fail). Run `check:idle --strict` from the 8F build and deploy with it quiet and nobody on Director: the launcher's boot migration drops the column while the old container may still serve, and that build's Director routes name the column (500 until the swap). **Never code-revert 8F:** the database keeps `0030` recorded, so a reverted build's schema names a column nothing re-adds, `/api/health` stays green and every Director route 500s. To bring the column back, ship a new migration that adds it (`docs/status/launcher.md` has the restore steps).
- **atlas-tool**: on ⚙ *Run generation on* = *My computer* it calls ComfyUI over the `comfy.invisiblewall.org` tunnel with CF Access headers + a custom User-Agent (Cloudflare 403s `Python-urllib`). `atlas-tool` hydrates its staging from R2 at start and per project on first use, then only on **↻ Refresh from R2** — after changing R2 data out-of-band, refresh; don't assume the staged copy is current.

## Secrets

Never put secrets in committed files — the pre-commit hook (`scripts/check-secrets.mjs`) blocks them. Set them as Railway env vars. If a secret was exposed, rotate it (see `docs/STATUS.md` security debts).
