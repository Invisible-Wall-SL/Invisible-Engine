# Vendored custom nodes (interactive R&D pod)

Two kinds of node live here (committed to the repo): ones we **wrote**, and third-party
ones we **locally modified**. Stock, unmodified nodes are cloned from GitHub in the
`Dockerfile` instead — don't vendor those.

## `ComfyUI-PuLID-Flux/` — the artist's MODIFIED PuLID-Flux node

This is a **duplicate** of `services/atlas-serverless/custom_nodes/ComfyUI-PuLID-Flux/`
(the artist's edited copy of `balazik/ComfyUI-PuLID-Flux`, with the `attn_mask` fix in
`pulidflux.py`). It is duplicated here — rather than shared — because **Docker `COPY`
cannot escape the build context**: this image builds with `context: services/atlas-comfy-pod`,
so it can only `COPY` files that live under this folder. Cloning the stock upstream node
would drop the artist's edits and error `forward_orig() got an unexpected keyword argument
'attn_mask'`.

**Keep the two copies in sync.** When the artist re-edits the node, update BOTH
`services/atlas-serverless/custom_nodes/ComfyUI-PuLID-Flux/` and this copy (see the
serverless `custom_nodes/README.md` for how to populate it — code only, no model weights).

## `ComfyUI-Invisible-ErrorRecall/` — ours, frontend-only

Ships **no nodes** — it exists to serve one JS file. ComfyUI fires `execution_error`
over the `/ws` socket exactly once; if that socket is down at that moment (RunPod's
proxy closing an idle connection, a sleeping laptop, a pod restart) nothing replays it,
so you reconnect to a canvas with no red node even though `/history` recorded the error.
The extension goes back to `/history` on reconnect and on page load, and paints the
error onto the node the socket failed to reach.

It never mutates the graph — highlighting goes through `app.lastNodeErrors`, the same
transient channel ComfyUI uses for `/prompt` validation errors, so nothing can be saved
into an artist's workflow. Every frontend API it touches is feature-detected, because
the frontend bundle is the fastest-moving part of ComfyUI and a debugging aid that
throws is worse than one that quietly does less.

Terminal-side equivalent for when the browser can't reach the pod at all:
`node scripts/comfy-last-error.mjs <comfy-url>`.

## `ComfyUI-SemanticLayers/` — ours, nodes-only

Routes the output of an image-layer decomposition model onto a **fixed** semantic
interface — `BACKGROUND`, `MAIN_CHARACTER`, `SECONDARY_CHARACTERS`, `ASSETS`,
`ENVIRONMENT`, `EFFECTS`, `OTHER` — so a downstream graph never depends on how many
layers the model emitted or in what order.

The problem it solves is specific to Qwen-Image-Layered as ComfyUI actually ships it
(core `EmptyQwenImageLayeredLatentImage` + `LatentCutToBatch(dim="t")` + `VAEDecode`):
the layers arrive as **one IMAGE batch of `layers + 1` RGB frames with no alpha and no
metadata whatsoever**. There is nothing to key on but the pixels, and layer order is not
a contract. So layer ids are **content hashes**, every routing decision is a pure
function of content + metadata, and the test suite asserts that shuffling the input
leaves both the assignments and the composited pixels byte-identical.

No pip dependencies — torch, PyYAML, numpy and Pillow all ship with ComfyUI. The
optional Florence-2 analyzer imports `transformers` lazily, so its absence disables one
dropdown entry rather than the extension. Taxonomy and keyword rules live in
`configs/default_taxonomy.yaml`, never in Python.

Full documentation, including exactly what was verified about the installed Qwen
implementation, is in its own `README.md`. Tests:
`"<ComfyUI>/python_embeded/python.exe" tests/run_tests.py` (45 tests).
