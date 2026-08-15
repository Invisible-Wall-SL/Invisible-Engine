# Atlas Maker — ComfyUI RunPod Serverless worker.
#
# Design: docs/design/comfyui-serverless.md
# - torch 2.8 + CUDA 12.8 (cu128) base — runs on BLACKWELL (sm_120: RTX 5090, RTX PRO
#   4000/4500/6000 Blackwell) AND is backward-compatible with Ada/Ampere/Hopper, so ONE
#   image covers every GPU tier. A cu124 build (torch 2.6) throws "no kernel image is
#   available" on Blackwell. cu128 torch is force-reinstalled LAST (see below).
# - ComfyUI + custom nodes are BAKED (cloned from GitHub). Models are NOT baked —
#   they come from the attached Network Volume at /runpod-volume (see
#   extra_model_paths.yaml). New models => drop on the volume, no rebuild.
# - Only a genuinely new custom NODE needs a rebuild (CI: .github/workflows/atlas-comfy-worker.yml).
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        git build-essential cmake curl wget ca-certificates \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# --- ComfyUI ------------------------------------------------------------------
# Pinned to v0.3.66 (2025-10-21) — the last release BEFORE comfy/quant_ops.py
# (added 2025-10-28) pulled in the `comfy_kitchen` backend (whose na3d op annotates a
# param as `list[int]`). Kept even on torch 2.8 for parity with the R&D pod image
# (services/atlas-comfy-pod) so prod + R&D stay in lockstep. Fully supports
# Flux + PuLID-Flux + our nodes, with zero comfy_kitchen.
ARG COMFYUI_REF=v0.3.66
RUN git clone https://github.com/comfyanonymous/ComfyUI /ComfyUI \
    && cd /ComfyUI && git checkout "${COMFYUI_REF}"
RUN pip install -r /ComfyUI/requirements.txt

# --- Custom nodes -------------------------------------------------------------
# STOCK blueprint helpers, cloned from GitHub. The three from
# services/atlas-tool/runpod/provision.sh, plus cubiq/PuLID_ComfyUI — the artist's
# Characterdesignertest3 blueprint uses its `PulidModelLoader` node (stock; the
# artist only modified pulidflux.py in the separate ComfyUI-PuLID-Flux folder).
WORKDIR /ComfyUI/custom_nodes
RUN git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus       ComfyUI_IPAdapter_plus && \
    git clone https://github.com/1038lab/ComfyUI-RMBG               ComfyUI-RMBG && \
    git clone https://github.com/Fannovel16/comfyui_controlnet_aux  comfyui_controlnet_aux && \
    git clone https://github.com/cubiq/PuLID_ComfyUI                PuLID_ComfyUI
# PuLID-Flux is the artist's LOCALLY-MODIFIED node — it is VENDORED in this repo and
# copied in as-is, NOT cloned. Cloning balazik/ComfyUI-PuLID-Flux would silently drop
# the artist's edits and break the Characterdesignertest3 blueprint. See ./custom_nodes/README.md.
COPY custom_nodes/ComfyUI-PuLID-Flux /ComfyUI/custom_nodes/ComfyUI-PuLID-Flux
# Install every node's Python deps (incl. the vendored PuLID folder now present here).
RUN for r in */requirements.txt; do echo "== deps: $r =="; pip install -r "$r" || true; done
# PuLID-Flux face stack — install explicitly so it can't be missed by a thin requirements.txt.
RUN pip install insightface onnxruntime-gpu facexlib timm ftfy

# --- Serverless handler runtime -----------------------------------------------
WORKDIR /
RUN pip install runpod requests

# --- cu128 torch (MUST be the LAST pip step) ----------------------------------
# ComfyUI + every node's requirements.txt can drag torch back to a stock cu124 build
# (the R&D pod image hit exactly this — torch kept reverting to cu124, which is dead on
# Blackwell). Force the Blackwell-capable cu128 build in LAST so nothing can clobber it.
RUN pip install --force-reinstall torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/cu128

COPY extra_model_paths.yaml /ComfyUI/extra_model_paths.yaml
COPY handler.py /handler.py
COPY start.sh   /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
