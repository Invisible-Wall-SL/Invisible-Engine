# ComfyUI

A cloud ComfyUI running on a RunPod GPU, for building and testing image-generation
networks. It's the third-party [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
node editor — this guide documents how it fits our pipeline: you do the GPU-heavy
R&D here, then export the network as an **Atlas Maker blueprint** the whole team can
generate with.

## What it is

A launcher **control panel** for an interactive ComfyUI hosted on a RunPod GPU pod.
Use it when a generation network is too heavy for your own machine (a laptop that OOMs
on SDXL/FLUX) — the canvas runs on the pod's GPU, not yours. The card starts and stops
the pod on demand, shows its live status, and opens ComfyUI once it's ready. Once a
network works, you export it and publish it as a blueprint in the
[Invisible Atlas Maker](atlas-maker.md), which turns "a graph one person tuned once"
into a repeatable pipeline step everyone can run over a manifest.

- **Where it runs:** `/comfyui` in the launcher — a full-page panel (behind auth,
  never an iframe) that renders the shared tool bar. The pod itself is external:
  **Open ComfyUI ↗** opens it in a **new tab** at its RunPod proxy URL
  (`https://<podId>-8188.proxy.runpod.net`, the launcher's `COMFY_RND_URL`). The
  launcher deliberately does **not** auto-redirect — the pod is on-demand and may be
  stopped, so the panel frames the pod with live status + Start/Stop controls instead
  of dumping you on a RunPod error page.
- **Access:** admin, developer, artist.

The panel has three shapes depending on how the launcher is configured:

- **Not configured** — no `COMFY_RND_URL` set: a "no R&D pod configured yet" state that
  names the env var to set. Nothing to open.
- **Open-link only** — `COMFY_RND_URL` is set but the RunPod control secrets
  (`RUNPOD_API_KEY` / `RUNPOD_POD_ID`) are not: a plain **Open ComfyUI ↗** button with
  no Start/Stop. If the pod is stopped you start it in the RunPod console yourself.
- **Full control panel** — URL + RunPod secrets set: live pod status plus Start, Open,
  and Stop, described below. This is the normal setup.

## How to use it

1. Open the **ComfyUI** card in the launcher (or go to `/comfyui`). The panel checks
   the pod's live status (it re-polls every few seconds) and shows one of:
   - **Pod running — ComfyUI is ready** → an **Open ComfyUI ↗** button and a **Stop
     pod** button.
   - **Pod is stopped** → a **Start pod** button.
   - **Warming up — this takes ~2 min** → no button; the panel switches itself to
     **Open ComfyUI** as soon as the pod answers.
2. If the pod is stopped, click **Start pod**. This resumes the RunPod GPU; expect
   about **2 minutes** before ComfyUI is reachable. If RunPod has no GPU free the panel
   surfaces a "GPU unavailable" error and the button becomes **Retry start** — try
   again in a moment.
3. Once it reads **ComfyUI is ready**, click **Open ComfyUI ↗** — the pod opens in a
   new tab. **Build** your network on the ComfyUI canvas. This runs on the pod's GPU,
   so you can iterate on models and node graphs your own machine can't hold.
4. **Export** the finished network: in ComfyUI, open **Settings → Save (API Format)**.
   That downloads the workflow as JSON in ComfyUI's API/prompt format — the shape the
   pipeline submits to ComfyUI. (This is *not* the editor's drag-and-drop save format;
   the Atlas Maker needs the API format.)
5. **Publish** it as a blueprint in the [Atlas Maker](atlas-maker.md): open
   **Blueprints → ＋ New blueprint**, upload the JSON, then bind the roles (point
   `positive`/`negative` prompt, `seed`, `width`/`height`, `style_ref`/`shape_ref`, and
   the `output` SaveImage node at their nodes in your graph) and declare any models the
   graph needs. See the blueprints design doc (`docs/design/invisible-blueprints.md`
   §3) for the authoring flow.
6. **When you're done, click Stop pod.** The GPU bills per second for as long as the
   pod runs, so stop it when you finish a session (see *Cost control* below).

Once published, the blueprint appears in the Atlas Maker's pipeline selector alongside
the built-in SDXL/FLUX/gpt_image pipelines, and any region can generate through it.

### Cost control (please read)

The RunPod GPU **bills per second only while the pod is running** — starting it costs
money until it stops. Two things keep that in check:

- **Stop pod** — the button on the panel. **Closing the browser tab does NOT stop the
  pod** (it keeps running, and billing, in the background). Stopping is an explicit
  action.
- **Idle auto-stop** — a launcher watchdog stops the pod automatically after a set
  number of idle minutes once ComfyUI's render queue is empty. While the `/comfyui`
  tab is open and visible it sends a heartbeat that keeps the pod alive, so the timer
  only really counts once you've walked away. When idle auto-stop is on, the panel
  shows "Auto-stops after N min idle". This is configured by an **admin**, not on this
  page: **Admin panel → Settings → "ComfyUI R&D pod" → Enable idle auto-stop + Idle
  minutes** (default 20). It's a safety net, not a substitute for pressing **Stop
  pod**.

### The one caveat that bites

**Any custom node or model your R&D network relies on must also exist on the shared
pipeline generation backend, or the blueprint won't run in the Atlas Maker.** The
R&D pod and the pipeline backend are separate environments:

- **Custom nodes** are baked into the pipeline's serverless worker image (cloned from
  their GitHub repos at build time) — a brand-new node needs a worker rebuild before a
  blueprint that uses it will run. Nodes that are rare/experimental won't be there
  until someone adds them.
- **Models** live on the pipeline's Network Volume (mirrored to R2) — a checkpoint or
  LoRA only reachable on the R&D pod isn't automatically available to the Atlas Maker.

So before you rely on a fresh node or model in a blueprint, check with the team that
it's on the shared backend (see `docs/design/comfyui-serverless.md` for how the worker
image and model volume are provisioned). If it isn't, the blueprint's generate step
fails with a missing-node/model error rather than producing art.

## Known limitations / TODOs

- **Start needs a free GPU.** Start resumes a specific RunPod pod; if RunPod has no GPU
  of that type available, Start fails with "GPU unavailable" and you retry until one
  frees up — there's no automatic fall-back to another GPU.
- **ComfyUI must auto-start on the pod.** The launcher can only resume the pod, not SSH
  in; the pod's container start command has to launch ComfyUI itself. If that's not set
  up, Start boots the GPU but the panel stays "warming up" forever because ComfyUI never
  answers. See the pod setup in `docs/INFRA.md` ("ComfyUI R&D pod").
- **Managing the pod's models/nodes still lives in RunPod.** The panel starts, stops,
  and opens the pod, but installing checkpoints/LoRAs and custom nodes happens on the
  pod itself (web terminal / SSH), not from this page.
- **Blueprint round-trip is owner-verify-owed.** The Atlas Maker blueprint pipeline is
  code-complete but a full live generate through a published blueprint is still owed
  (see `docs/design/invisible-blueprints.md` §7). Treat a freshly published blueprint
  as unverified until it's generated a real region.
