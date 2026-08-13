# Atlas R&D — INTERACTIVE ComfyUI pod image (RunPod pods, NOT serverless).
#
# Why this exists: installing Python deps by hand inside a running pod does NOT
# survive RunPod recreating the container on resume (the container id changes →
# tqdm/torch/etc. get wiped → ComfyUI crash-loops). Models are safe (they live on
# the Network Volume); only the container's site-packages are lost. Baking every
# dep into the image fixes this for good — a fresh container already has everything.
#
# Sibling image: services/atlas-serverless (the HEADLESS serverless worker). This one
# is the INTERACTIVE web-UI pod: no runpod handler, ComfyUI auto-starts on 8188 and
# stays up in the background so a crash never locks the artist out of the terminal.
#
# CI: .github/workflows/atlas-comfy-pod.yml → ghcr.io/invisible-wall-sl/atlas-comfy-pod
#
# --- Base -------------------------------------------------------------------------
# BLACKWELL (sm_120) is mandatory here: the R&D pods are RTX PRO 4000/4500 Blackwell.
# torch MUST be a cu128 build (>= 2.7) or the GPU throws "no kernel image is available".
# The serverless base is pytorch 2.6 + cuda12.4 (cu124) and will NOT run on Blackwell,
# so we start from a CUDA 12.8 PyTorch base and (re)install cu128 torch LAST (below).
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        git build-essential cmake curl wget ca-certificates \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# --- ComfyUI ----------------------------------------------------------------------
# Pinned to v0.3.66 (2025-10-21) — the last release BEFORE comfy/quant_ops.py pulled
# in the `comfy_kitchen` backend (whose na3d op annotates a param as `list[int]`, which
# torch's infer_schema rejects → ComfyUI crashes on import). Matches the serverless
# worker (services/atlas-serverless COMFYUI_REF=v0.3.66) so R&D and prod stay in lockstep.
# Do NOT let ComfyUI-Manager "Update ComfyUI".
ARG COMFYUI_REF=v0.3.66
RUN git clone https://github.com/comfyanonymous/ComfyUI /ComfyUI \
    && cd /ComfyUI && git checkout "${COMFYUI_REF}"
# NOTE: this pulls stock cu124 torch as a dependency — that's fine, we force cu128 last.
RUN pip install -r /ComfyUI/requirements.txt

# --- Custom nodes -----------------------------------------------------------------
# Baked so a recreated container already has them (the whole point of this image).
# Stock nodes cloned from GitHub; the artist's MODIFIED PuLID-Flux is COPY'd from the
# in-repo vendored copy (see ./custom_nodes/README.md — cloning stock balazik would drop
# the attn_mask fix and break the blueprint).
WORKDIR /ComfyUI/custom_nodes
RUN git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus       ComfyUI_IPAdapter_plus && \
    git clone https://github.com/1038lab/ComfyUI-RMBG               ComfyUI-RMBG && \
    git clone https://github.com/Fannovel16/comfyui_controlnet_aux  comfyui_controlnet_aux && \
    git clone https://github.com/cubiq/PuLID_ComfyUI                PuLID_ComfyUI && \
    git clone https://github.com/Comfy-Org/ComfyUI-Manager          ComfyUI-Manager
# Vendored, artist-modified PuLID-Flux (duplicated into this build context so COPY can
# reach it — Docker COPY can't escape the context to ../atlas-serverless).
COPY custom_nodes/ComfyUI-PuLID-Flux /ComfyUI/custom_nodes/ComfyUI-PuLID-Flux

# Install every node's Python deps (incl. the vendored PuLID folder + Manager).
RUN for r in */requirements.txt; do echo "== deps: $r =="; pip install -r "$r" || true; done
# PuLID / PuLID-Flux face stack — install explicitly so a thin requirements.txt can't miss it.
RUN pip install insightface onnxruntime-gpu facexlib timm ftfy

# ComfyUI-Manager: security level "middle" so artists can add nodes from the web UI on a
# remote pod. Pre-seed its config in BOTH known locations (newer Manager reads
# user/default/ComfyUI-Manager/config.ini; older reads custom_nodes/ComfyUI-Manager/config.ini).
RUN mkdir -p /ComfyUI/user/default/ComfyUI-Manager && \
    printf '[default]\nsecurity_level = middle\n' | tee \
        /ComfyUI/user/default/ComfyUI-Manager/config.ini \
        /ComfyUI/custom_nodes/ComfyUI-Manager/config.ini > /dev/null

# --- cu128 torch (MUST be the LAST pip step) --------------------------------------
# Every step above (ComfyUI + each node's requirements.txt) can drag torch back to a
# stock cu124 build (we hit exactly this — torch kept reverting to 2.4.1+cu124). Force
# the Blackwell-capable cu128 build in LAST so nothing can clobber it.
RUN pip install --force-reinstall torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/cu128

# --- Entrypoint -------------------------------------------------------------------
WORKDIR /
COPY extra_model_paths.yaml /ComfyUI/extra_model_paths.yaml
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8188
# Auto-starts ComfyUI on 8188 and keeps the container alive → NO RunPod "Container Start
# Command" is needed. A ComfyUI crash never takes the container down (see start.sh).
CMD ["/start.sh"]
