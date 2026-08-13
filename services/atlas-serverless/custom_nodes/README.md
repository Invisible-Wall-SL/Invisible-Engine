# Vendored custom nodes

Only nodes that are **locally modified** live here (committed to the repo). Stock,
unmodified nodes are cloned from GitHub in the `Dockerfile` instead — don't vendor those.

## `ComfyUI-PuLID-Flux/` — the artist's MODIFIED PuLID-Flux node

The `Characterdesignertest3` blueprint depends on the artist's **edited** copy of
`balazik/ComfyUI-PuLID-Flux` (at least `pulidflux.py` is changed). Cloning the upstream
repo would drop those edits and break the blueprint, so the exact folder is vendored
here and `COPY`d into the image.

**To populate it** (one-time, and again if the artist re-edits the node):
1. Artist zips their folder `C:\Invisible Wall SL\ComfyUI\Shared\custom_nodes\ComfyUI-PuLID-Flux-master`.
   - **Code only.** Exclude any model weights inside it (`.safetensors`, `.pt`, `.pth`,
     `.onnx`, `.bin`) — those are models and belong on the Network Volume, not the image.
2. Unzip its contents into `services/atlas-serverless/custom_nodes/ComfyUI-PuLID-Flux/`
   so `pulidflux.py` sits directly in that folder.
3. Commit it. The next CI build bakes it in.

Until this folder holds the real node, the worker image build is incomplete (PuLID
generations will fail).
