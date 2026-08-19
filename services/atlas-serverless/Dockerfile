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
# Pinned to a TAG on purpose — never track master. This is the PROD generation path;
# an unpinned core would change generation behaviour on a plain rebuild, with no commit.
#
# History: pinned to v0.3.66 (2025-10-21) for ~10 months because comfy/quant_ops.py had
# pulled in the `comfy_kitchen` backend, whose na3d op annotated a param as `list[int]`
# and got rejected by torch's infer_schema. Fixed upstream since: quant_ops.py no longer
# registers a torch.library op, and comfy_kitchen is now a version-pinned wheel
# (comfy-kitchen==0.2.31) in ComfyUI's own requirements.txt.
#
# MUST stay equal to services/atlas-comfy-pod COMFYUI_REF so prod + R&D stay in lockstep
# — bump both in ONE PR, and promote here only after the R&D pod renders clean.
ARG COMFYUI_REF=v0.33.1
RUN git clone https://github.com/comfyanonymous/ComfyUI /ComfyUI \
    && cd /ComfyUI && git checkout "${COMFYUI_REF}"
RUN pip install -r /ComfyUI/requirements.txt

# --- Custom nodes -------------------------------------------------------------
# STOCK blueprint helpers, cloned from GitHub. The three from
# services/atlas-tool/runpod/provision.sh, plus cubiq/PuLID_ComfyUI — the artist's
# Characterdesignertest3 blueprint uses its `PulidModelLoader` node (stock; the
# artist only modified pulidflux.py in the separate ComfyUI-PuLID-Flux folder).
#
# PINNED TO COMMITS — these were bare `git clone`s of the default branch, so a rebuild
# could pull different node code against a frozen core with no commit of ours. Keep the
# SHAs equal to services/atlas-comfy-pod so R&D and prod run identical node code.
WORKDIR /ComfyUI/custom_nodes
# 12-char SHAs, not 40: a full hex SHA trips the repo secret scanner, and a trailing
# `# pragma` would be swallowed into the ARG value rather than read as a comment.
ARG IPADAPTER_REF=a0f451a5113c
ARG RMBG_REF=9edb2bec3900
ARG CONTROLNET_AUX_REF=e8b689a513c3
ARG PULID_REF=93e0c4c226b8
RUN set -eux; \
    clone_at() { git clone "$1" "$2" && git -C "$2" checkout --quiet "$3"; }; \
    clone_at https://github.com/cubiq/ComfyUI_IPAdapter_plus      ComfyUI_IPAdapter_plus "${IPADAPTER_REF}"; \
    clone_at https://github.com/1038lab/ComfyUI-RMBG              ComfyUI-RMBG           "${RMBG_REF}"; \
    clone_at https://github.com/Fannovel16/comfyui_controlnet_aux comfyui_controlnet_aux "${CONTROLNET_AUX_REF}"; \
    clone_at https://github.com/cubiq/PuLID_ComfyUI               PuLID_ComfyUI          "${PULID_REF}"
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
# VERSION-PINNED — keep equal to services/atlas-comfy-pod so R&D and prod share a torch.
ARG TORCH_REF=2.11.0
ARG TORCHVISION_REF=0.26.0
ARG TORCHAUDIO_REF=2.11.0
RUN pip install --force-reinstall \
    "torch==${TORCH_REF}" "torchvision==${TORCHVISION_REF}" "torchaudio==${TORCHAUDIO_REF}" \
    --index-url https://download.pytorch.org/whl/cu128

COPY extra_model_paths.yaml /ComfyUI/extra_model_paths.yaml
COPY handler.py /handler.py
COPY start.sh   /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
