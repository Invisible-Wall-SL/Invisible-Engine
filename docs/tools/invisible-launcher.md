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

- The source is `C:\Invisible Wall SL\ComfyUI\Invisible_Launcher.py` (a
  customtkinter app — lives outside the engine repo because it manages the local
  ComfyUI install).
- It's packaged into a one-file Windows `.exe` with
  [`scripts/build-launcher-exe.py`](../../scripts/build-launcher-exe.py)
  (PyInstaller `--onefile`), then uploaded to R2 at
  `tools/invisible-launcher/Invisible_Launcher.exe` together with a manifest
  `tools/invisible-launcher/latest.json` (`{version, size, sha256, notes}`).
- The web launcher serves both over **open** routes (no portal login, since the
  desktop app has no session): `/api/launcher/download` (the exe, also what the
  portal card links to) and `/api/launcher/latest` (the manifest, polled by the
  self-update check).

```
py scripts/build-launcher-exe.py                       # build only (artifact in %TEMP%)
py scripts/build-launcher-exe.py --upload              # build + push exe + manifest to R2
py scripts/build-launcher-exe.py --upload --notes "…"  # include release notes in the prompt
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

## Related

- [ComfyUI](comfyui.md) — what the launcher installs + starts.
- `docs/INFRA.md` — the tunnel, Cloudflare Access, R2.
