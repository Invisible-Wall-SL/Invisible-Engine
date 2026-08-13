# Vendored custom nodes (interactive R&D pod)

Only nodes that are **locally modified** live here (committed to the repo). Stock,
unmodified nodes are cloned from GitHub in the `Dockerfile` instead — don't vendor those.

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
