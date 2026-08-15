# Atlas Maker — ComfyUI RunPod Serverless worker.
#
# Design: docs/design/comfyui-serverless.md
# - torch 2.6 base (comfy_kitchen / quant_ops need >= ~2.5's PEP-585 custom_op schema).
# - ComfyUI + custom nodes are BAKED (cloned from GitHub). Models are NOT baked —
#   they come from the attached Network Volume at /runpod-volume (see
#   extra_model_paths.yaml). New models => drop on the volume, no rebuild.
# - Only a genuinely new custom NODE needs a rebuild (CI: .github/workflows/atlas-comfy-worker.yml).
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        git build-essential cmake curl wget ca-certificates \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# --- ComfyUI ------------------------------------------------------------------
# Pinned to v0.3.66 (2025-10-21) — the last release BEFORE comfy/quant_ops.py
# (added 2025-10-28) pulled in the `comfy_kitchen` backend. comfy_kitchen's na3d op
# annotates a param as `list[int]`, which torch 2.6's infer_schema rejects (it only
# accepts typing.List[int]) → ComfyUI crashes on import. v0.3.66 fully supports
# Flux + PuLID-Flux + our nodes and works with torch 2.6, with zero comfy_kitchen.
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

# --- Serverless handler -------------------------------------------------------
WORKDIR /
RUN pip install runpod requests
COPY extra_model_paths.yaml /ComfyUI/extra_model_paths.yaml
COPY handler.py /handler.py
COPY start.sh   /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
