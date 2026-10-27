# draft-player

Plays a QA draft (ADR-0010, PLAN card 9D) in the headless shell and reports which screens it
reached, which it did not, where a wait stalled and what the console said. It reuses the
current-games harness libraries (`scripts/current-games/lib/*`) **unchanged by relative import** and
never edits them: any edit under `scripts/current-games/**` fails `current-games-verdict.yml`.
It does not touch math, never publishes, and writes nothing to R2: it holds no R2 or database
credential, the launcher sends presigned URLs.

Plain Node 22 ESM. Not a pnpm workspace member and no `package.json`: no install, no lockfile.

| File | What |
|---|---|
| `src/playDraft.mjs` | `playDraft({ draftDir, runtimeDir, contract, kind, scenarios?, chrome, out, seed?, intercept?, signal? })` -> the ADR-0010 §4 report |
| `src/cli.mjs` | `--draft --runtime --contract --kind --out [--scenario id]…` prints the report JSON |
| `src/server.mjs` | the HTTP service: `POST /play`, `GET /progress`, `POST /cancel`, `GET /health` |
| `src/signing.mjs` | the `X-Draft-Signature` scheme, both directions |
| `Dockerfile` | the image (build context: the repo root) |
| `playDraft.fixture.mjs`, `server.fixture.mjs` | offline fixtures; run by `pnpm check:all` (no browser) |
| `playDraft.browser.mjs` | the real thing: a stand-in draft played in a real browser, by hand |

A draft folder has a published snapshot's layout: `runtime.json` + `deploy/**`, plus `draft.json`
(`draftId`, `runtime`, `projectKey`/`gameKey`, `name`, and for a stand-in `standIn`, `assetBase`).
`kind` picks the harness script (`screens/<kind>.json`; an unknown kind plays `lines`'). One side is
played, no compare. Scenarios needing a feature the contract lacks (`requires`) are listed in
`notPlayed`. A refused boot is known after 10 frames and the other scenarios are not booted.

## Fixtures

```bash
# Offline, seconds, in CI (check:all discovers *.fixture.mjs):
node --experimental-strip-types --import ./scripts/ts-loader.mjs services/draft-player/playDraft.fixture.mjs
node --experimental-strip-types --import ./scripts/ts-loader.mjs services/draft-player/server.fixture.mjs

# Browser, about a minute, by hand. Builds the runtime into .cache/current-games/runtimes/working-tree
# (about 90 s) and writes the stand-in games when missing:
node --experimental-strip-types --import ./scripts/ts-loader.mjs services/draft-player/playDraft.browser.mjs
```

`playDraft.browser.mjs` is not named `*.fixture.mjs` on purpose: `check:all` would run it on CI,
which has no runtime build. It proves a good draft (every expected screen, no console error, no
stall), a refused boot, a console error, a stuck state, and the service end to end. It answers the
Typekit hosts with a local kit because the sandbox cannot reach Adobe; the service itself does not
(players load fonts from Adobe, and so does the service on Railway).

## The service

Env: `DRAFT_PLAYER_SECRET` (shared with the launcher; required) and `PORT` (Railway sets it).
Nothing else. The image sets `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`.

`POST /play`, `POST /cancel` and `GET /progress` carry
`X-Draft-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>\n<METHOD> <path+query>\n<raw body>")>`
(300 s tolerance; `signing.mjs`). The same header signs the callback POST, over the callback URL's
path and query. `/health` is open. `POST /play` takes the JSON documented at the top of
`src/server.mjs` (presigned `https` URLs only; a draft's files, the runtime's files, PUT URLs for
the report and up to 40 shots, a callback URL and token), answers 202 and plays one job at a time.
The runtime is cached by version (two kept); the draft is downloaded per play and deleted.
Job results are kept in memory for an hour for `/progress`. The service holds no state worth
keeping, so a restart makes a job `unknown` and the launcher submits it again (ADR-0010 §3).

## Deploying

Waits for the owner (ADR-0010 is approved; creating the private Railway service is an owner step):
Root Directory = repo root, Dockerfile Path = `services/draft-player/Dockerfile`, no public domain,
variable `DRAFT_PLAYER_SECRET` here and on the launcher, plus `DRAFT_PLAYER_URL` on the launcher.
Memory 1 GB is enough for one play (SwiftShader); measure on first deploy.
