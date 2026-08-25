# ComfyUI

A cloud ComfyUI running on a RunPod GPU, for building and testing image-generation
networks. It's the third-party [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
node editor — this guide documents how it fits our pipeline: you do the GPU-heavy
R&D here, then export the network as an **Atlas Maker blueprint** the whole team can
generate with.

## What it is

A launcher **control panel** for a **fleet** of interactive ComfyUI pods hosted on
RunPod GPUs. Use it when a generation network is too heavy for your own machine (a
laptop that OOMs on SDXL/FLUX) — the canvas runs on a pod's GPU, not yours. The panel
lists every pod in the fleet, each on its own row with a live status badge and its own
Start / Open / Stop controls, so you can start whichever card has a free GPU. Once a
network works, you export it and publish it as a blueprint in the
[Invisible Atlas Maker](atlas-maker.md), which turns "a graph one person tuned once"
into a repeatable pipeline step everyone can run over a manifest.

**Why a fleet, not one pod?** A stopped pod does not reserve its GPU, so on a scarce
card (e.g. an RTX PRO Blackwell) a Start can fail with "not enough free GPUs" when you
come back to resume it. Keeping several pods on different GPU cards means you can just
start the next one instead of waiting for a specific GPU to free up.

- **Where it runs:** `/comfyui` in the launcher — a full-page panel (behind auth,
  never an iframe) that renders the shared tool bar. The pods themselves are external:
  a pod's **Open ComfyUI ↗** opens it in a **new tab** at its RunPod proxy URL, which
  is **derived from the pod id** (`https://<podId>-8188.proxy.runpod.net`). The
  launcher deliberately does **not** auto-redirect — the pods are on-demand and may be
  stopped, so the panel frames each one with live status + Start/Stop controls instead
  of dumping you on a RunPod error page.
- **Access:** admin, developer, artist.

The panel has two shapes depending on how the launcher is configured:

- **Not configured** — no fleet and no RunPod key: a "no R&D pods are configured yet"
  state that tells you to set `RUNPOD_API_KEY` and add pods in the admin panel (a
  legacy single `RUNPOD_POD_ID` still works too). Nothing to start.
- **Fleet control panel** — `RUNPOD_API_KEY` set and at least one pod configured: the
  list of pods with per-pod Start / Open / Stop, described below. This is the normal
  setup.

## How to use it

1. Open the **ComfyUI** card in the launcher (or go to `/comfyui`). The panel probes
   every pod's live status concurrently and re-polls every few seconds. Each pod shows
   up as a row with its **label** (e.g. "RTX 4090") and a status badge:
   - **running** (green) → an **Open ComfyUI ↗** button and a **Stop** button.
   - **starting** (amber, "Warming up ~2 min…") → a **Cancel** button; the row switches
     itself to **running** as soon as that pod's ComfyUI answers.
   - **stopped** (grey) → a **Start** button, and a second badge saying whether that card
     can be rented right now — **GPU available** (grey), **GPU stock low** (amber) or **no
     GPUs free** (orange) — mirroring what RunPod's own console shows for that card in your
     region. Hover it for the data centre the answer covers. It is a *hint*:
     stock moves between the reading and your click, so a Start can still come back "not
     enough free GPUs" — but a card reading **no GPUs free** is one to skip.

     **No badge means RunPod would not say**, and the row then looks exactly as it did
     before the feature existed. If that is because RunPod refused the question, a short
     orange line under the fleet quotes its answer, so a missing badge is never a silent
     one. (An early version showed RunPod's *pricing* stock word on every card and read
     "low" on all of them in a region where most were not rentable — a vague badge is
     worse than none, because it looks like an answer.)

   Under the badge each row shows the card's **Cost/hr**, **VRAM** and **Processor**,
   read live from RunPod — so you pick by what the job needs (does the model fit? what
   does an hour cost?) rather than by the label alone. A figure RunPod doesn't report is
   left out rather than guessed; VRAM and the GPU name only appear once RunPod has
   assigned the pod a machine, so a pod that has never run in this launcher session can
   show price alone until its first Start.
2. Pick a card and click **Start**. This resumes that RunPod GPU; expect about
   **2 minutes** before ComfyUI is reachable. If RunPod has no GPU of that card free,
   the Start fails and the reason (e.g. "not enough free GPUs") shows **inline on that
   pod's row**, and its button becomes **Retry**. Rather than waiting, just **start a
   different pod** in the fleet — that is the whole point of keeping several.
3. Once a row reads **running**, click its **Open ComfyUI ↗** — the pod opens in a new
   tab, and that click takes a **one-hour lease** so idle auto-stop can't reclaim the
   pod while you work (see *Cost control*). **Build** your network on the ComfyUI
   canvas. This runs on the pod's GPU, so you can iterate on models and node graphs your
   own machine can't hold.
   - **Start only one pod at a time.** When the fleet's pods share a Network Volume
     (models + custom nodes), running two at once risks write conflicts on that volume.
     Stop the one you're done with before starting another.
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
6. **When you're done, click Stop on that pod's row.** The GPU bills per second for as
   long as the pod runs, so stop it when you finish a session (see *Cost control*
   below).

   Each row also shows the **Image** it is deployed from — the build tag, or `latest (mutable)` for a pod deployed before this existed. Under the fleet, **Pod image** names the newest CI build and, for admins, offers **Rebuild image**: it runs the pod-image workflow on `main` (a cached rebuild is ~2 min, a full one ~30) and the line updates itself while it runs. When a stopped pod is behind the newest successful build, an **Update to `<sha>`** button appears on its row. That reads the pod, changes only its image, reads it back, and then tells you what changed — including that the ports and the `/workspace` volume were untouched. RunPod recreates the container, so anything hand-installed on that pod is lost; **models on the Network Volume are not**. A running pod refuses the change — stop it first.

   **Custom nodes** under that bar lists everything baked into the image, with each node's pin and the note explaining why it is there. Admins can **add** one: paste a GitHub repo URL, press **Resolve** — which shows the exact commit that would be pinned, with its subject and date — then **Add & commit**. That writes `services/atlas-comfy-pod/nodes.json` on `main`, attributed to you, and the commit triggers the image build by itself. **remove** does the same in reverse. Two entries are marked *vendored in the repo*: those are files, not list rows, and are changed in a PR.

Once published, the blueprint appears in the Atlas Maker's pipeline selector alongside
the built-in SDXL/FLUX/gpt_image pipelines, and any region can generate through it.

### What's installed (models + custom nodes)

Under the pod list there's a collapsible **What's installed** panel that answers "is
that checkpoint/LoRA/node actually up there?" without opening ComfyUI. It is read
**live from a pod** — never from a list someone maintains by hand — and it separates
the two things people conflate:

- **Models** — the contents of the shared **Network Volume**, grouped by folder
  (`checkpoints`, `loras`, `vae`, …). Click a folder to see the filenames. Every pod
  mounts the same volume, so this list is the same whichever pod answered, and a model
  you drop on the volume stays there when a pod stops.
- **Custom node packs** — what the answering pod's ComfyUI actually loaded, with how
  many nodes each pack registers. **These live in the pod's container image, not on the
  volume**: a pack you install with ComfyUI-Manager is written into the running
  container and **disappears the next time RunPod recreates the pod** (which happens on
  resume). To keep a pack, it has to be added to the pod image
  (`services/atlas-comfy-pod/Dockerfile`) and the image rebuilt. The panel says so
  inline, because this is the single most confusing thing about the fleet.

The panel reads once when the page loads and again when you press **Refresh** (press it
right after installing something — the server caches the answer for a minute). It never
starts or stops a pod.

**It works with the whole GPU fleet stopped**, provided an always-on **volume pod** is
configured — a cheap CPU pod that mounts the same Network Volume and serves ComfyUI's
HTTP API. Without one, the panel can only read from a GPU pod that happens to be
running, and otherwise says so. See *Managing the fleet* below.

### Managing the fleet (admins)

The fleet is managed in the launcher's admin panel, not on this page: **Admin panel →
Settings → "ComfyUI R&D pod fleet"**. There an admin can:

- **Add / remove pods** — each pod is a **pod id** (the RunPod pod id) plus a **label**
  (e.g. "RTX 4090"). The ComfyUI URL is derived from the id automatically, so there's
  no per-pod URL to enter. "Save fleet" persists the list; a live status badge next to
  each row reflects the last probe. The fleet is stored in the launcher's settings
  (`app_settings` key `runpodPods`); a legacy single `RUNPOD_POD_ID` env still shows up
  as a synthesized "Default" pod when the list is empty.
- **Configure idle auto-stop** — the enable toggle + idle minutes (default 20) for the
  watchdog described below.

The optional **volume pod** that keeps *What's installed* answering while the GPU fleet
is stopped is set in the launcher environment, not the admin UI: `COMFY_VOLUME_POD_ID`
(a RunPod pod id — its ComfyUI URL is derived like any other pod) or `COMFY_VOLUME_URL`
(an explicit base URL). Point it at an always-on CPU pod that mounts the same Network
Volume and runs ComfyUI in CPU mode; it only ever has to answer HTTP, never generate.
Leave both empty and the panel falls back to any running GPU pod.

### Cost control (please read)

The RunPod GPU **bills per second only while a pod is running** — starting one costs
money until it stops. Two things keep that in check:

- **Stop** — the button on each running pod's row. **Closing the browser tab does NOT
  stop the pod** (it keeps running, and billing, in the background). Stopping is an
  explicit action.
- **Idle auto-stop** — a launcher watchdog stops an idle pod automatically after a set
  number of minutes. It is deliberately reluctant, because reclaiming a GPU drops your
  ComfyUI session; a pod is stopped only when none of these holds it:
  - **You opened ComfyUI.** Clicking **Open ComfyUI ↗** takes a **one-hour session
    lease** on the fleet, and the panel then reads "Held for another N min while you
    work". This covers the long stretch where you're *building* a network — real work
    that leaves the render queue empty and would otherwise look idle. **Re-open ComfyUI
    (or press Open again) to extend it** if a session runs past the hour.
  - **A render is running or queued**, or ComfyUI can't be reached at all. An
    unreachable ComfyUI counts as busy, never as idle — it goes quiet while loading a
    checkpoint or decoding, exactly when the pod is working hardest.
  - **The idle window hasn't fully elapsed**, confirmed several times in a row. One
    unlucky reading can never reclaim a pod.

  When idle auto-stop is on, the panel shows what's holding the pod and for how long.
  This is configured by an **admin** under **Admin panel → Settings → "ComfyUI R&D pod
  fleet" → Enable idle auto-stop + Idle minutes** (default 20). It's a safety net, not a
  substitute for pressing **Stop** — and note the lease is fleet-wide, so it holds
  whichever pod is running (you should only run one at a time anyway).

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

- **Start needs a free GPU, and there's no auto-fallback.** Start resumes a specific
  pod; if RunPod has no GPU of that card available, Start fails ("not enough free
  GPUs") and you must manually **start a different pod** in the fleet — the panel does
  not pick a free card for you. A stopped pod does not reserve its GPU, so scarce cards
  (e.g. Blackwell) can be unresumable until one frees up.
- **One pod at a time on a shared volume.** When fleet pods share a Network Volume
  there's no lock preventing two from running at once; the guardrail is procedural —
  stop one before starting another to avoid write conflicts on the shared models/nodes.
- **ComfyUI must auto-start on the pod.** The launcher can only resume a pod, not SSH
  in; the pod's container start command has to launch ComfyUI itself. If that's not set
  up, Start boots the GPU but the row stays "starting" forever because ComfyUI never
  answers. See the pod setup in `docs/INFRA.md` ("ComfyUI R&D pod").
- **You can see the pod's models/nodes, but not change them from here.** *What's
  installed* lists them; installing a checkpoint/LoRA or a custom node still happens on
  the pod itself (web terminal / SSH / ComfyUI-Manager), not from this page.
- **"Which packs are permanent?" is only answered when the pod can tell us.** Without a
  reporting route on the pod, the panel lists the packs ComfyUI loaded but cannot say
  which sit on the volume and which are container-only — hence the blanket warning
  rather than a per-pack marker.
- **Blueprint round-trip is owner-verify-owed.** The Atlas Maker blueprint pipeline is
  code-complete but a full live generate through a published blueprint is still owed
  (see `docs/design/invisible-blueprints.md` §7). Treat a freshly published blueprint
  as unverified until it's generated a real region.
