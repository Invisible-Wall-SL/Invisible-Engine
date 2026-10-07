# Invisible Launcher (desktop)

The small Windows desktop app that turns a workstation into a **build machine** for standalone
games: it syncs your projects from the portal, builds them against the latest engine, and
publishes (☁ Publish) or packages them for a partner (📦 Deliver). It can also run **ComfyUI** on
your own GPU and open the **Cloudflare tunnel** to it, for when you choose *Run generation on → My
computer* in the Atlas Maker — production generation runs in the cloud and does not need it.

## What it is

- **Where it runs:** on your Windows machine, as a single `.exe` — it is the one Invisible tool
  that is not a page in the launcher. It signs in to the portal to fetch your projects and to
  publish.
- **Access:** listed under *Local tools* for **admin**, **developer**, **artist**,
  **pipelineTester** and **audio**. Publishing needs the **Build & publish games**
  (`gamePublish`) capability, which an admin grants in /admin → Roles.

## What it does

- **Projects → ☁ Publish / 📦 Deliver / 🏗 Scaffold** — sync, build and ship a game; see
  *Projects* below. This is what most people use it for.
- **Install / Update ComfyUI** *(optional)* — downloads the official **Windows portable** build
  (`ComfyUI_windows_portable_nvidia.7z`) from GitHub, extracts it (an installed 7-Zip, or the
  standalone `7zr.exe` it fetches), installs the ComfyUI-Manager requirements and wires up the
  config paths (`comfyui_dir` / `python_exe`). Installs to
  `C:\Invisible Wall SL\ComfyUI\ComfyUI_windows_portable\`, with a progress bar throughout.
- **Start ComfyUI** — launches ComfyUI on `localhost:8188`.
- **Start tunnel** — brings up the Cloudflare named tunnel so the cloud Atlas Maker can reach this
  machine's GPU at `comfy.invisiblewall.org` (*Run generation on → My computer*).
- **Sync models** *(admin)* — pulls the shared model mirror from R2 onto this machine's ComfyUI.
- **Check for updates** (header) — compares the running `LAUNCHER_VERSION` against the published
  manifest and, if a newer build exists, downloads it and updates itself in place (see
  *Self-update* below).

## Getting it

1. Sign in to the portal at **app.invisiblewall.org** (invite-only).
2. On the launcher home, find **Invisible Launcher** under *Local tools* and click **Download** —
   this serves the `.exe` (open route `/api/launcher/download`).
3. Run the `.exe` (no install step — it's a single file). On first run it self-installs its few
   Python UI dependencies.
4. Sign in with your portal account, then **↻ Sync** your projects. Only if you want to generate on
   your own GPU: **Install / Update ComfyUI**, then **Start tunnel**.

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

Sync clones private game repos with no GitHub sign-in only for accounts that hold
**Build & publish games** (`gamePublish`) — the same grant ☁ Publish needs. Without
it, a clone falls back to Git's own sign-in prompt.

**☁ Publish uploads through the portal, as you** *(from **v1.0.56**)*. The built
bundle goes to the portal (`api/launcher/game-upload`), and the portal writes it to
R2. You need your portal sign-in with **Build & publish games**, and **no R2
credentials**. Before this, every publishing desktop needed a copy of the bucket's
write key, which meant the key could never be rotated. Three things make the portal
route quick and safe:

- **Unchanged files are skipped.** The portal reports what the game's cloud folder
  already holds, so a republish sends only what changed. A retry after a dropped
  connection is quick for the same reason.
- **An oversized file is caught before anything is sent.** The portal reports its
  real per-file limit (32 MB by default), and any file over it stops the publish
  up front with its name. Ticking 🗜 Optimize usually fixes it.
- **Nothing is registered half-uploaded.** The portal checks that every file arrived
  before it touches the games list. An interrupted publish leaves the previous build
  serving.

The owner can still send bundles straight to the bucket: Settings → *Advanced: ☁ Publish
games straight to R2 with saved owner credentials* (off by default). With it on, the
launcher still switches to the portal route in two cases. One is **R2 unreachable**:
Spanish ISPs null-route Cloudflare's ranges during LaLiga matches. The other is **R2
refusing the saved key**, which is how a rotated key looks from a machine that kept the
old one. Nothing else re-routes. A key the online Game Maker owns still stops the
publish, and the portal runs the same check itself.

**Every build says which build it is.** ☁ Publish and 📦 Deliver number each build
from one counter per game. Each build records where it came from:

- the build number and time,
- the **engine commit actually compiled** (the advanced submodule, not the repo's pin),
- the game repo's commit,
- the sha256 of the pnpm lockfile it installed from,
- the launcher version.

That record is written to `build-info.json` beside the bundle, so it is uploaded with a
publish and travels inside a delivery. The engine also bakes it into the game: type
`__IE_BUILD__` in the browser console of a running game. The publish dialog shows the
short fingerprints, a delivery's result dialog shows them too, and the partner's
`EMBED.md` lists them in §5.

**When the engine refuses a build, you get its reason, not a log tail.** The engine
stops a build at three gates:

- **an invalid flow**: Invisible Flow validation errors,
- **a drifted paytable**: the authored paytable disagrees with the partner's
  captured one,
- **missing art** (📦 Deliver only): placed regions or rigs that no shipped atlas
  contains.

The launcher shows a **Build refused** dialog with the engine's own reason and every
finding. It also offers the override, but only once you tick *I understand — ship this
anyway*. The button stays disabled until then, and Enter never confirms. A flow or
paytable override rebuilds with that one gate lifted (`ALLOW_INVALID_FLOW=1` /
`ALLOW_PAYTABLE_DRIFT=1`). A missing-art override only re-packages the build already on
disk, which takes seconds. The fix itself belongs in the tool that owns the data. See the
[publisher runbook](../guides/publisher-runbook.md) for what each refusal means.

**🗜 Optimize never makes the art worse** *(from v1.0.56)*. PNG atlas pages become
**near-lossless WebP**, the setting the engine's page store uses: no pixel moves by
more than 4/255, and a page stays a PNG if WebP would not be smaller. WebP pages the
server already encoded are **left untouched**. Other PNGs are re-packed losslessly,
and audio is trimmed to mp3. Until v1.0.55 Optimize re-encoded everything, those
server pages included, as lossy WebP q80 plus 256-colour PNGs. On Book of Borut Remake
that moved opaque pixels by up to 108/255, which is visible banding. The upload is
bigger than it was then, and the art is the art that was authored.

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

## Traps

- **A fix you made in a synced project's folder vanished, or never reached the build.** — Every ☁
  Publish hard-resets a synced project's folder to the game repo's `origin` before building, which
  discards uncommitted edits, so only what is committed **and pushed** is built. Commit and push the
  fix to the game repo first. (A project added with *Load from folder* is left as it is.)
- **The publish result says the live server "hadn't caught up".** — The build did upload; the test
  server just had not switched to it within the wait. Reopen the game from the portal in a minute
  or so to confirm.

## Related

- [Publisher runbook](../guides/publisher-runbook.md) — the one-page checklist for ☁ Publish and
  📦 Deliver, and what each refusal means.

- [ComfyUI](comfyui.md) — the cloud ComfyUI; the launcher's local install is the optional
  *My computer* alternative.
- [Invisible Game Maker](game-maker.md) — where a project's game kind is authored,
  and where a data-only project is published without any local build.
- `docs/INFRA.md` — the tunnel, Cloudflare Access, R2.
