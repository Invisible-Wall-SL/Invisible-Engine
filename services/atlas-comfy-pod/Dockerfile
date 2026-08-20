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
# Pinned to a TAG on purpose — never track master. An unpinned core would let a plain
# image rebuild change generation behaviour with no commit of ours, and would let this
# image and the serverless worker drift apart on separate rebuild days. Bump both in ONE PR.
#
# History: we sat on v0.3.66 (2025-10-21) for ~10 months because comfy/quant_ops.py had
# pulled in the `comfy_kitchen` backend, whose na3d op annotated a param as `list[int]`
# and got rejected by torch's infer_schema → crash on import. Fixed upstream since:
# quant_ops.py no longer registers a torch.library op, and comfy_kitchen is now a
# VERSION-PINNED wheel (comfy-kitchen==0.2.31) in ComfyUI's own requirements.txt.
#
# v0.33.1 also brings FLUX.2 in core — no custom node needed. Models are NOT baked; fetch
# them onto the Network Volume with services/atlas-tool/runpod/fetch-models.py.
#
# MUST stay equal to services/atlas-serverless COMFYUI_REF so R&D and prod stay in lockstep.
# Still do NOT use ComfyUI-Manager's "Update ComfyUI" — it patches the ephemeral container
# layer only, so it silently reverts on the next container recreate. Bump this ARG instead.
ARG COMFYUI_REF=v0.33.1
RUN git clone https://github.com/comfyanonymous/ComfyUI /ComfyUI \
    && cd /ComfyUI && git checkout "${COMFYUI_REF}"
# NOTE: this pulls stock cu124 torch as a dependency — that's fine, we force cu128 last.
RUN pip install -r /ComfyUI/requirements.txt

# --- Custom nodes -----------------------------------------------------------------
# Baked so a recreated container already has them (the whole point of this image).
# Stock nodes cloned from GitHub; the artist's MODIFIED PuLID-Flux is COPY'd from the
# in-repo vendored copy (see ./custom_nodes/README.md — cloning stock balazik would drop
# the attn_mask fix and break the blueprint).
#
# PINNED TO COMMITS. These used to be bare `git clone`s of the default branch, so any
# rebuild could pull different node code against a frozen core — a bigger silent-drift
# hole than the core pin itself, and how ComfyUI-Manager updated itself into a "core is
# outdated, installs blocked" state without anyone changing a file here. Bump a SHA
# deliberately, the same way COMFYUI_REF is bumped.
WORKDIR /ComfyUI/custom_nodes
# 12-char SHAs, not 40: a full hex SHA trips the repo secret scanner, and a trailing
# `# pragma` would be swallowed into the ARG value rather than read as a comment.
ARG IPADAPTER_REF=a0f451a5113c
ARG RMBG_REF=9edb2bec3900
ARG CONTROLNET_AUX_REF=e8b689a513c3
ARG PULID_REF=93e0c4c226b8
# PuLID for FLUX.2 (iFayens). NOT core-native like FLUX.2/Wan — the weights are inert
# without this node, so `pulid-flux2` in fetch-models.py is only usable from an image
# built at or after this line. Two standing risks, both reasons to smoke-test it rather
# than trust it: (a) it works by monkey-patching block.forward and model_function_wrapper,
# the most fragile possible coupling to core internals, and its last commit (2026-05-21)
# predates our v0.33.1 bump by ~3 months; (b) its own tracker carries an open
# SingleStreamBlock attn_mask kwarg conflict — the same class of bug the vendored FLUX.1
# PuLID-Flux needed a local fix for. If it breaks, vendor + patch it the way that one was.
# LICENCE: node and weights are MIT, but it needs InsightFace antelopev2, which is
# non-commercial research only — so this path is R&D and can never ship in a game.
ARG PULID_FLUX2_REF=3a0a3f5f1826
ARG MANAGER_REF=f39cbd56feca
RUN set -eux; \
    clone_at() { git clone "$1" "$2" && git -C "$2" checkout --quiet "$3"; }; \
    clone_at https://github.com/cubiq/ComfyUI_IPAdapter_plus      ComfyUI_IPAdapter_plus "${IPADAPTER_REF}"; \
    clone_at https://github.com/1038lab/ComfyUI-RMBG              ComfyUI-RMBG           "${RMBG_REF}"; \
    clone_at https://github.com/Fannovel16/comfyui_controlnet_aux comfyui_controlnet_aux "${CONTROLNET_AUX_REF}"; \
    clone_at https://github.com/cubiq/PuLID_ComfyUI               PuLID_ComfyUI          "${PULID_REF}"; \
    clone_at https://github.com/iFayens/ComfyUI-PuLID-Flux2       ComfyUI-PuLID-Flux2    "${PULID_FLUX2_REF}"; \
    clone_at https://github.com/Comfy-Org/ComfyUI-Manager         ComfyUI-Manager        "${MANAGER_REF}"
# Vendored, artist-modified PuLID-Flux (duplicated into this build context so COPY can
# reach it — Docker COPY can't escape the context to ../atlas-serverless).
COPY custom_nodes/ComfyUI-PuLID-Flux /ComfyUI/custom_nodes/ComfyUI-PuLID-Flux
# Ours, frontend-only (no nodes, no deps): re-surfaces a run's error on the failing node
# when the /ws socket dropped before ComfyUI could report it. See its __init__.py.
COPY custom_nodes/ComfyUI-Invisible-ErrorRecall /ComfyUI/custom_nodes/ComfyUI-Invisible-ErrorRecall

# Install every node's Python deps (incl. the vendored PuLID folder + Manager).
RUN for r in */requirements.txt; do echo "== deps: $r =="; pip install -r "$r" || true; done
# PuLID / PuLID-Flux face stack — install explicitly so a thin requirements.txt can't miss
# it, AND so a stale pin in one node can't drag a shared package backwards.
#
# open-clip-torch is PuLID-Flux2's EVA-CLIP loader. That node's requirements.txt also pins
# `ml_dtypes==0.3.2` and `numpy<2.0.0`, and the loop above applied both: the first build
# with it shipped ml_dtypes 0.3.2 (down from the 0.6.0 onnx->insightface had pulled) and
# onnx 1.19.0 (down from 1.22.0). numpy recovered on its own — the cu128 torch step below
# reinstalls 2.4.6 last — and that is what made the pin dangerous rather than merely wrong:
# ml_dtypes 0.3.2 is a Jan-2024 C extension built against the numpy 1.x array API, so under
# numpy 2 it raises `AttributeError: _ARRAY_API not found` on import (verified directly).
# onnx declares ml_dtypes as a hard dependency and insightface imports onnx, so leaving it
# un-importable puts the whole face stack at risk — including the FLUX.1 PuLID-Flux path
# that predates this node and was verified working.
#
# FLOORS, not pins: raise what a node dragged down, without freezing a version here that
# the requirements above would then fight over on every rebuild.
RUN pip install insightface onnxruntime-gpu facexlib timm ftfy open-clip-torch \
    "ml_dtypes>=0.5.4" "onnx>=1.22"

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
# VERSION-PINNED too: this step used to install whatever cu128 torch was newest that day,
# so two rebuilds a week apart shipped different torch. These are the versions current
# when the v0.33.1 bump landed; keep them equal to the serverless worker's.
ARG TORCH_REF=2.11.0
ARG TORCHVISION_REF=0.26.0
ARG TORCHAUDIO_REF=2.11.0
RUN pip install --force-reinstall \
    "torch==${TORCH_REF}" "torchvision==${TORCHVISION_REF}" "torchaudio==${TORCHAUDIO_REF}" \
    --index-url https://download.pytorch.org/whl/cu128

# --- Pod tools --------------------------------------------------------------------
# BAKED so no pod ever has to fetch it. The runbook used to say `curl … from
# raw.githubusercontent.com`, which silently 404s: this repo is PRIVATE and GitHub
# answers 404 rather than 401 for those, so it reads as "file missing" (see
# services/atlas-tool/runpod/README.md). Shipping the script in the image removes the
# credential problem entirely — `python /fetch-models.py --list` just works.
#
# The file LIVES here (./tools/) rather than beside its siblings in
# services/atlas-tool/runpod/ because Docker COPY cannot escape the build context. The
# alternatives were duplicating it — the ComfyUI-PuLID-Flux compromise, which is exactly
# how a vendored copy drifts — or moving the context to the repo root, which would ship
# the whole monorepo to the builder on a job that already has to reclaim ~25 GB of disk.
# One copy, in the image that consumes it.
COPY tools/fetch-models.py /fetch-models.py
# Serves ComfyUI on a SECOND port so the pod can have both a TCP port (direct link) and
# an HTTP proxy port at once — RunPod refuses to give one container port both. Pure
# stdlib on purpose: socat is not in this image, and adding an apt package to solve a
# 40-line problem is a worse trade. Started by start.sh.
COPY tools/port-forward.py /port-forward.py

# --- Entrypoint -------------------------------------------------------------------
WORKDIR /
COPY extra_model_paths.yaml /ComfyUI/extra_model_paths.yaml
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8188
# Auto-starts ComfyUI on 8188 and keeps the container alive → NO RunPod "Container Start
# Command" is needed. A ComfyUI crash never takes the container down (see start.sh).
CMD ["/start.sh"]
