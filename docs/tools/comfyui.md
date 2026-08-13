# ComfyUI

A cloud ComfyUI running on a RunPod GPU, for building and testing image-generation
networks. It's the third-party [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
node editor — this guide documents how it fits our pipeline: you do the GPU-heavy
R&D here, then export the network as an **Atlas Maker blueprint** the whole team can
generate with.

## What it is

A launcher card that opens an interactive ComfyUI hosted on a RunPod GPU pod. Use it
when a generation network is too heavy for your own machine (a laptop that OOMs on
SDXL/FLUX) — the canvas runs on the pod's GPU, not yours. Once a network works, you
export it and publish it as a blueprint in the
[Invisible Atlas Maker](atlas-maker.md), which turns "a graph one person tuned once"
into a repeatable pipeline step everyone can run over a manifest.

- **Where it runs:** `/comfyui` in the launcher — a full-page landing (behind auth,
  never an iframe) that renders the shared tool bar and links out to the pod. The pod
  itself is external: it opens in a **new tab** at its RunPod proxy URL
  (`https://<podId>-8188.proxy.runpod.net`, the launcher's `COMFY_RND_URL`). The
  launcher deliberately does **not** auto-redirect — the pod is an on-demand resource
  that may be stopped, so it frames the link with context instead of dumping you on a
  RunPod error page.
- **Access:** admin, developer, artist.

## How to use it

1. Open the **ComfyUI** card in the launcher (or go to `/comfyui`). You'll see a short
   intro and an **Open ComfyUI ↗** button.
2. Click **Open ComfyUI ↗** — the pod opens in a new tab. If it doesn't load, the pod
   is stopped: start it in the RunPod console, then try again.
3. **Build** your network on the ComfyUI canvas. This runs on the pod's GPU, so you
   can iterate on models and node graphs your own machine can't hold.
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

Once published, the blueprint appears in the Atlas Maker's pipeline selector alongside
the built-in SDXL/FLUX/gpt_image pipelines, and any region can generate through it.

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

- **The pod is on-demand.** It scales/stops to save cost; if the Open button lands on
  an error, the pod is stopped and must be started in the RunPod console first. When
  `COMFY_RND_URL` is unset the page shows a "no R&D pod configured" state (with the env
  var name to set) instead of the Open button.
- **No launcher-side pod controls.** The card only links out — starting/stopping the
  pod and managing its models happens in the RunPod console, not here.
- **Blueprint round-trip is owner-verify-owed.** The Atlas Maker blueprint pipeline is
  code-complete but a full live generate through a published blueprint is still owed
  (see `docs/design/invisible-blueprints.md` §7). Treat a freshly published blueprint
  as unverified until it's generated a real region.
