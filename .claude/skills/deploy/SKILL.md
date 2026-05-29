---
name: deploy
description: Deploy checklist for this monorepo's Railway services (launcher, atlas-backend, atlas-tool). Use when the user wants to ship/deploy a change, or asks why a deploy "isn't working". Encodes the hard-won gotchas (always push, staged env vars, verify the runtime).
---

# Deploy

Railway auto-deploys each service from GitHub `main` on push. There is no manual deploy step — **pushing to `main` IS the deploy**. The mistakes that waste time are always the same; this checklist prevents them.

## Procedure

1. **Build locally first** (catch errors before they reach Railway):
   - Node service (launcher): `pnpm --filter launcher-api build`
   - Python service (`atlas-backend`/`atlas-tool`): `py -m py_compile services/<svc>/*.py`
2. **Commit** with a concise imperative message. End with the Co-Authored-By line.
3. **Push** — `git push origin HEAD`. ⚠️ This is the step most often forgotten. A commit that isn't pushed does NOT deploy. After pushing, confirm with `git log origin/main..HEAD --oneline` (should be empty).
4. **Verify the running service actually picked up the change** — do not assume. Poll the live URL until it reflects the new code (e.g. a new route returns 200/401 instead of 404, or a changed response appears). Service URLs are in `docs/INFRA.md`.

## Env var changes (the #1 source of "it deployed but didn't work")

- On Railway, **adding/editing a variable only STAGES it**. You must click the **"Apply changes / Deploy"** banner at the top. A plain "Redeploy" of an old deployment does **NOT** apply staged variables.
- For **non-secret** config (URLs, flags), prefer a **code default** (see `apps/launcher-api/src/lib/server/env.ts`) so a deploy never depends on the dashboard being right.
- When a var "isn't working" after the user says they set it + redeployed: **don't keep telling them to re-check the dashboard.** Verify what the runtime actually sees — temporarily expose a no-secret diagnostic (e.g. a public `+server.ts` returning `{ configured: boolean, RAILWAY_SERVICE_NAME }`), hit it on the live URL, then remove it.

## Service-specific notes

- **Launcher** (`Invisible launcher` project): serves `app.invisiblewall.org`. Has Postgres. Routes under `(app)/` require auth+role.
- **atlas-backend / atlas-tool**: both call local ComfyUI over the `comfy.invisiblewall.org` tunnel with CF Access headers + a custom User-Agent (Cloudflare 403s `Python-urllib`). `atlas-tool` hydrates its staging from R2 **only at container start**, so after seeding R2 you must **restart it**.

## Secrets

Never put secrets in committed files — the pre-commit hook (`scripts/check-secrets.mjs`) blocks them. Set them as Railway env vars. If a secret was exposed, rotate it (see `docs/STATUS.md` security debts).
