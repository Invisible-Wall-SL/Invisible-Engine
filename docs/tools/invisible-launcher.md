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
  auto-fetches the tiny standalone `7zr.exe`), and wires up the config paths
  (`comfyui_dir` / `python_exe`). Installs to
  `C:\Invisible Wall SL\ComfyUI\ComfyUI_windows_portable\`.
- **Start ComfyUI** — launches the shared ComfyUI service on `localhost:8188`.
- **Start tunnel** — brings up the `comfy-gualtiero` Cloudflare named tunnel so
  the cloud Atlas Maker can reach this machine's GPU at
  `comfy.invisiblewall.org`.

## Getting it

1. Sign in to the portal at **app.invisiblewall.org** (invite-only).
2. On the launcher home, find **Invisible Launcher** under *Local tools* and
   click **Download** — this serves the `.exe` from R2 (auth-gated route
   `/download/launcher`).
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
  `tools/invisible-launcher/Invisible_Launcher.exe`.
- The web launcher's `/download/launcher` route (under the authed `(app)` group)
  streams that object back as a download. Re-run the build script with
  `--upload` whenever the launcher changes to publish a new build.

```
py scripts/build-launcher-exe.py            # build only (artifact in %TEMP%)
py scripts/build-launcher-exe.py --upload   # build + push to R2 (needs R2_* env)
```

## Related

- [ComfyUI](comfyui.md) — what the launcher installs + starts.
- `docs/INFRA.md` — the tunnel, Cloudflare Access, R2.
