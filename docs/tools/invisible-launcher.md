# Invisible Launcher (desktop)

The small Windows desktop app that runs on the **local GPU machine** and keeps
the only two local pieces of the pipeline alive: **ComfyUI** and the
**Cloudflare tunnel**. Everything else (the portal, Atlas Maker, atlas-backend,
R2) is cloud-hosted — the Invisible Launcher is how a workstation joins the
pipeline.

> This replaces the old "download ComfyUI yourself" flow. Artists/devs no longer
> install ComfyUI by hand — the launcher fetches the correct build for them.

## What it does

- **Install / Update ComfyUI** — downloads the official **Windows portable**
  build (`ComfyUI_windows_portable_nvidia.7z`) straight from GitHub, extracts it
  (no manual 7-Zip step — the launcher uses an installed 7-Zip if present, else
  auto-fetches the tiny standalone `7zr.exe`), installs the ComfyUI-Manager
  requirements (so `--enable-manager` works), and wires up the config paths
  (`comfyui_dir` / `python_exe`). Installs to
  `C:\Invisible Wall SL\ComfyUI\ComfyUI_windows_portable\`. A **progress bar**
  (determinate during the download %, indeterminate while extracting) shows
  feedback throughout.
- **Start ComfyUI** — launches the shared ComfyUI service on `localhost:8188`.
- **Start tunnel** — brings up the `comfy-gualtiero` Cloudflare named tunnel so
  the cloud Atlas Maker can reach this machine's GPU at
  `comfy.invisiblewall.org`.
- **Check for updates** (header) — compares the running `LAUNCHER_VERSION`
  against the published manifest and, if a newer build exists, downloads it and
  updates itself in place (see *Self-update* below).

## Getting it

1. Sign in to the portal at **app.invisiblewall.org** (invite-only).
2. On the launcher home, find **Invisible Launcher** under *Local tools* and
   click **Download** — this serves the `.exe` from R2 (open route
   `/api/launcher/download`).
3. Run the `.exe` (no install step — it's a single file). On first run it
   self-installs its few Python UI dependencies.
4. Click **Install / Update ComfyUI**, then **Start tunnel**.

## How it's distributed

- The source lives in its own git repo **`invisible-launcher`**
  (`Invisible-Wall-SL/invisible-launcher`) — a customtkinter app, kept out of the
  engine repo because it manages the local ComfyUI install. On the owner's box it's
  checked out at both `C:\Invisible Wall SL\Projects\invisible-launcher` and
  `C:\Invisible Wall SL\ComfyUI`; keep whichever you release from level with
  `origin/main` first.
- It's packaged into a one-file Windows `.exe` by **`build_and_publish.py` in that
  repo** (PyInstaller `--onefile`), then uploaded to R2 at
  `tools/invisible-launcher/Invisible_Launcher.exe` together with a manifest
  `tools/invisible-launcher/latest.json` (`{version, size, sha256, notes}`). The
  script builds from its OWN repo copy (so it can't go stale) and reads R2 creds
  from the saved launcher config or `R2_*` env. (Replaces the former engine-side
  `scripts/build-launcher-exe.py`, removed 2026-06-14 — it built from a clone that
  could drift behind `main` and silently re-ship a stale version.)
- The web launcher serves both over **open** routes (no portal login, since the
  desktop app has no session): `/api/launcher/download` (the exe, also what the
  portal card links to) and `/api/launcher/latest` (the manifest, polled by the
  self-update check).

```
# run from the invisible-launcher repo, after bumping LAUNCHER_VERSION
py build_and_publish.py                 # build + publish (exe + manifest to R2)
py build_and_publish.py --build-only    # build only (artifact in dist/)
py build_and_publish.py --skip-build    # publish an already-built dist exe
py build_and_publish.py --notes "…"     # release notes recorded in latest.json
```

## Self-update

`LAUNCHER_VERSION` is embedded in the launcher source and stamped into the R2
manifest at build time. **Check for updates** (header button) fetches
`/api/launcher/latest`, and if its `version` is greater it offers to update.

Windows can't overwrite a running `.exe`, so the update is a *swap-on-restart*:
the launcher downloads the new exe to `%TEMP%`, verifies its `sha256`, relaunches
it with `--apply-update <old-path>`, then exits; the new exe copies itself over
the old path (retrying until the lock releases) and relaunches. **To release a
new version:** bump `LAUNCHER_VERSION`, then run the build with `--upload`.
(Self-update only runs from the frozen `.exe`; from source it tells you to
`git pull` instead.)

## Projects — build & publish a standalone game

The **Projects** tab lists the projects your account can reach. **↻ Sync from
cloud** pulls them from the portal, clones the ones that have a repo, and pulls
their shared assets; **☁ Publish** on a card then does the whole build in one
press — fetch + hard-reset to `origin/main`, advance the engine submodule to its
branch tip, `pnpm install && pnpm build` (assets pull live from R2), upload the
bundle, register the game card, verify it's live.

**If your connection can't reach R2, ☁ Publish re-routes itself.** Spanish ISPs
null-route whole Cloudflare address ranges during LaLiga matches, and R2's storage
endpoint sits inside them — so on those lines a publish used to die instantly with
`ConnectTimeoutError` and upload nothing, while everything else (the portal, the test
server, the games themselves) kept working. From **v1.0.53** the launcher notices that
specific failure and uploads through the portal instead, which is not behind the block;
you'll see *"R2 is unreachable from this connection … publishing through the portal
instead"* in the progress log, and the publish finishes normally. Nothing is rebuilt and
nothing else changes. It re-routes **only** for a connection failure: a wrong credential
or a key the online Game Maker owns still stops the publish, as they should.

**Every publish builds the latest engine.** A game repo holds no game code of its
own: the game layer is compiled straight from the engine submodule that the step
above just advanced to `main`, so there is no engine version to choose and no way
for a build to fall behind. (Until 2026-09-17 each repo carried a copy of the
engine's game layer, frozen on the day it was scaffolded — that is what made
builds ship a months-old game. If an older repo still has a `src/` folder the
build ignores it and says so; `git rm -r src` clears it up.)

**…and from v1.0.55 it fills in the engine packages your repo's `package.json`
never heard of.** The step above builds the *current* game layer, and when the
engine gains a new shared package (`engine-game`, `game-config`, …) a repo
scaffolded before it had no line declaring it — so the build stopped at
`Rollup failed to resolve import "engine-game"`, naming a package you never chose
not to depend on. The publish now compares your manifest against the engine's own
game app and declares whatever is missing at `workspace:*` before installing,
listing what it added in the progress log. It applies that **to the build only**:
the folder is hard-reset on every publish, so nothing is committed or pushed on
your behalf — make the same edit in the game repo when you want it fixed at rest.

**You don't pick a template for an existing project.** A project's **game kind**
(Lines, Book of, Ways, Cluster, Scatter, or a custom kind) is authored online —
in Invisible Game Maker or the editor's kind picker — and the portal sends it
down with every Sync. The launcher derives the build command, the mock RGS
protocol and the RGS env from it, so Edit shows a read-only **"Game kind —
authored in the portal"** row rather than a picker: a local change would be
reverted by the next Sync, and until then the two ends would disagree about which
mock the game is dealt. Change the kind where it's authored.

- **Custom build** — tick *Use a custom build for this project* on that row when a
  game's build genuinely differs (a non-standard command, cwd or output dir). The
  Advanced boxes then win and nothing rewrites them.

### 🏗 Scaffold — give an online project a standalone build

A project authored in the portal is **data-only** by design: Invisible Game Maker
ships it through the shared runtime bundle, so it has no repo and no build. Sync
leaves an empty placeholder folder for it, and ☁ Publish can only report that the
folder is empty.

**🏗 Scaffold** on the project's card closes that gap in one press: it creates the
game repo (engine submodule + build wiring), makes the first commit, pushes a
private GitHub repo if the `gh` CLI is signed in, and shares the setup so every
other machine clones it on the next Sync. Then ☁ Publish works like any other
game. Nothing is typed — the folder, the cloud key and the build all follow the
project it's scaffolding for, and the repo carries no game code, so it tracks the
engine automatically.

- It appears **only on a project that has no repo**, and disappears once used.
- Needs *Engine dir* set in Settings (it drives the engine's own scaffolder) and,
  for the sharing step, the owner account.
- **Your cloud authoring data is untouched.** The scaffolded build pulls art,
  fonts, scenes and sounds live from R2 at build time — scaffolding adds a repo
  and changes nothing else.
- If the game was **already published online**, publish the desktop build under a
  different key: the two publish paths refuse to overwrite each other's card.

> **🎮 New Project** is the other direction — for a game that does *not* exist in
> the portal yet. It creates the portal project too. For a repo you already have,
> point *Game root folder* at the clone and press **⬆ Setup**.

> Online publish and desktop publish are different products and deliberately
> refuse to overwrite each other's game card. Keep the keys distinct — `<game>`
> for the desktop build, `<game>remake` for the online one.

### 📦 Deliver — build the folder a partner hosts

*(from **v1.0.54**)* **☁ Publish** puts a game on *our* server. **📦 Deliver** produces the folder
somebody *else* serves — a client, a casino operator, an aggregator — from their
own domain, launched by their own page. Nothing is uploaded, no game card is
registered and the test server is never told.

Press it and you pick two things:

- **Delivery profile** — which RGS the build belongs to. This is baked in
  permanently: a delivered build's wallet is not something the host page gets to
  repoint later. `operator-embed` is the one to use for a real handover — it names
  no RGS host at all, because the operator's own page *is* the origin. The list —
  and the one-line description under the picker — is read out of *that project's*
  engine submodule, so a new partner profile arrives with the engine rather than
  with a launcher release.
- **Game alias** — the CDN folder their page composes the script URL from. Their
  convention is the game's display name with the spaces removed (*Book Of Borut* →
  `BookOfBorut`), which is what the box is prefilled with. **Get it wrong and
  their script tag 404s**, so confirm it with them rather than assuming. Clear the
  box and the engine guesses from the repo name instead — and `EMBED.md` then tells
  the partner the alias is a guess they must confirm, which is not what you want a
  handover to say.

You get a `delivery/` folder beside the repo's `build/` (**📁 Open folder** in the
result dialog goes straight there), a `<alias>.zip` next to it whose root folder
*is* the alias, and an `EMBED.md` written for the partner: where to put the folder,
what their page must set, and the two lines they add to it (the dialog shows those
two lines too, with a **Copy** button). Two values in them are **fixed and cannot
vary per game** — the container id `game` and the filename `game.js` — because
one page of theirs serves every game and composes the URL server-side, so it can
neither pass a per-game id nor know a content hash. Their cache-buster is the
`versionPath` folder, which is why the whole folder moves per release.

**▶ Play it, in the result dialog, is not optional polish.** A delivery build
cannot be opened: there is no `index.html`, and it reads the session and RGS path
from `window.params.GameSettings`, which only the partner's page supplies — so
double-clicking the folder gets you nothing, correctly. Paste a session token from
their platform and their RGS origin into *session (sid)* and *RGS origin*, and it
plays here exactly as it will on their page, wallet included: a fake operator page
opens on `localhost:4599`, serving the build at a CDN-shaped path that shares
nothing with the page, and proxying your RGS origin same-origin the way their
infrastructure does. Without it, the first person ever to run the build is the
operator.

- Leave the fields empty and it still loads, then refuses at the session check —
  which is itself worth seeing once, because that refusal is what protects a
  mis-wired embed from showing a player a wallet nobody issued.
- 🐞 **Debug** and 🗜 **Optimize** are the card's own checkboxes, read when you press
  **📦 Deliver** — set them first, the dialog has no copy of them. They mean
  the same as for a publish, except that here Debug ships the in-game debug tooling
  *to the partner*, so untick it for a real handover.
- **You still have to be signed in**, even though nothing is uploaded: the build
  pulls live art, fonts and scenes from R2 with a token fetched from the portal.
  Without it the progress log warns and the build falls back to the repo's
  placeholder art — a handover nobody wants to make twice.
- Needs the project's engine submodule to be recent; if it predates delivery
  builds the launcher says so and one ☁ Publish advances it. It also needs the
  card's *Cloud publish* settings, same as a publish — a data-only project has to
  be 🏗 Scaffolded first.

## Related

- [ComfyUI](comfyui.md) — what the launcher installs + starts.
- [Invisible Game Maker](game-maker.md) — where a project's game kind is authored,
  and where a data-only project is published without any local build.
- `docs/INFRA.md` — the tunnel, Cloudflare Access, R2.
