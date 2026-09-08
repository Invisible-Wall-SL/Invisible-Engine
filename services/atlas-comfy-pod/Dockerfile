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
# LAYER ORDER IS LOAD-BEARING. Docker's cache is linear: change a layer and everything
# below it rebuilds. So this file is ordered CHEAP-AND-STABLE FIRST, VOLATILE LAST —
# base → torch → ComfyUI core → face stack → CUSTOM NODES → checks → entrypoint. Adding
# a custom node is the common change and it must only invalidate the tail. Torch used to
# be last, held there so no node's requirements.txt could clobber the cu128 build; that
# job now belongs to ./constraints.txt, which enforces it without dictating order. Read
# that file before moving anything in here.
#
# --- Base -------------------------------------------------------------------------
# BLACKWELL (sm_120) is mandatory here: the R&D pods are RTX PRO 4000/4500 Blackwell.
# torch MUST be a cu128 build (>= 2.7) or the GPU throws "no kernel image is available".
# The serverless base is pytorch 2.6 + cuda12.4 (cu124) and will NOT run on Blackwell,
# so we start from a CUDA 12.8 PyTorch base and install cu128 torch over it (below).
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

# System packages. This layer is near the top, so touching it still costs a FULL rebuild —
# that is the right trade for something that changes once a year, but it does mean a node
# needing a new apt package is the one node addition that is not cheap.
#
# ffmpeg is here for ComfyUI-VideoHelperSuite. Its own dep `imageio-ffmpeg` ships a
# bundled binary, so the pack imports without this — but that build is a fixed, reduced
# one, and the pack's h265 / ProRes / av1-webm / NVENC format presets want a full encoder
# set. VHS scores every ffmpeg it can find by codec support and takes the best
# (`ffmpeg_suitability` in videohelpersuite/utils.py), so shipping both is safe.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git build-essential cmake curl wget ca-certificates \
        libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# --- Dependency rules (must precede every pip step) --------------------------------
# `PIP_CONSTRAINT` is pip's env form of `--constraint`, so EVERY pip install below obeys
# this file without each step having to remember to pass it — including pip installs made
# later on a LIVE pod, by hand or by ComfyUI-Manager's "install node" button. That last
# part is new protection: until now a Manager install could pull a node whose requirements
# quietly downgraded torch on a running pod.
COPY constraints.txt /constraints.txt
ENV PIP_CONSTRAINT=/constraints.txt

# --- cu128 torch (FIRST pip step, so it is installed exactly once) -----------------
# This used to be the LAST pip step, force-reinstalled over whatever ComfyUI and the nodes
# had dragged in. Now it goes first and constraints.txt keeps it: `torch==2.11.0` is
# already satisfied by `2.11.0+cu128`, so every later `pip install` that merely requires
# torch skips it instead of re-resolving a stock build off PyPI. Net effect — torch is
# downloaded once per build rather than twice, and it can never be silently swapped.
#
# Versions live in constraints.txt, NOT here: naming them in both places is how two files
# start disagreeing. `TORCH_CUDA` is the one thing the constraint file cannot express (a
# local build tag is not a version bound), so it is an ARG — and it is handed to
# verify-deps.py below, which FAILS the build if the installed torch is not that build.
ARG TORCH_CUDA=cu128
RUN pip install --force-reinstall torch torchvision torchaudio \
    --index-url "https://download.pytorch.org/whl/${TORCH_CUDA}"
ENV EXPECTED_TORCH_CUDA=${TORCH_CUDA}

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
RUN pip install -r /ComfyUI/requirements.txt

# --- Face stack -------------------------------------------------------------------
# The PuLID / PuLID-Flux face packages, installed EXPLICITLY so a thin node
# requirements.txt can't miss one. It sits above the custom nodes rather than below them
# now: it used to run afterwards to undo damage the node loop had done, and constraints.txt
# prevents that damage instead of repairing it. Keeping it here means adding a node doesn't
# reinstall onnxruntime-gpu.
#
# open-clip-torch is PuLID-Flux2's EVA-CLIP loader, and `safetensors` completes the exact set
# that node's own requirements.txt tells you to install by hand instead of running the file
# (the loop below skips it for that reason — see there). `ml_dtypes` and `onnx` are NOT named
# here any more: their floors moved into constraints.txt, where they also bind the node
# requirements loop (see that file for what those two floors are protecting against).
RUN pip install insightface onnxruntime-gpu facexlib timm ftfy open-clip-torch safetensors

# boto3 for the two R2 mirror scripts baked below. They are useless without it — a pod
# answered `ModuleNotFoundError: No module named 'boto3'` the same day they were baked,
# which is a tool shipped without its one dependency. Its own layer, above the volatile
# node tail: it is small, it never changes, and a node edit must not reinstall it.
RUN pip install boto3

# --- Custom nodes (THE VOLATILE TAIL — everything above must stay cached) ----------
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
# The list itself is ./nodes.json, NOT a wall of ARGs — that is what lets the launcher add a
# node from /comfyui without a repo checkout (Phase 2 of docs/design/comfyui-node-manager.md).
# It stays in git either way, so an image still reproduces from `git checkout <sha> && docker build`.
#
# Read with PYTHON rather than jq: the base image already has python, and adding an apt package
# to parse a file we control is a worse trade. The pipe-separated intermediate keeps the shell
# loop POSIX (`IFS='|' read`), since RUN executes under dash, not bash.
#
# Each node is pinned to a COMMIT. These were bare `git clone`s of the default branch once, so
# any rebuild could pull different node code against a frozen core — a bigger silent-drift hole
# than the core pin itself, and how ComfyUI-Manager updated itself into a "core is outdated,
# installs blocked" state without anyone changing a file here. The per-node reasons that used to
# live in this comment block now travel with the entries, in nodes.json's `note` fields.
COPY nodes.json /nodes.json
RUN set -eu; \
    python -c "import json;print('\n'.join('%s|%s|%s' % (n['name'], n['url'], n['sha']) for n in json.load(open('/nodes.json'))['nodes'] if n.get('url')))" > /tmp/nodes.txt; \
    test -s /tmp/nodes.txt; \
    while IFS='|' read -r name url sha; do \
        [ -n "$name" ] || continue; \
        echo "== clone: $name @ $sha"; \
        git clone --quiet "$url" "$name"; \
        git -C "$name" checkout --quiet "$sha"; \
    done < /tmp/nodes.txt
# Vendored, artist-modified PuLID-Flux (duplicated into this build context so COPY can
# reach it — Docker COPY can't escape the context to ../atlas-serverless).
COPY custom_nodes/ComfyUI-PuLID-Flux /ComfyUI/custom_nodes/ComfyUI-PuLID-Flux
# Ours, frontend-only (no nodes, no deps): re-surfaces a run's error on the failing node
# when the /ws socket dropped before ComfyUI could report it. See its __init__.py.
COPY custom_nodes/ComfyUI-Invisible-ErrorRecall /ComfyUI/custom_nodes/ComfyUI-Invisible-ErrorRecall
# Ours, nodes-only (no deps beyond what ComfyUI already ships): routes a layered
# decomposer's variable layer batch onto fixed semantic outputs. See its README.md.
COPY custom_nodes/ComfyUI-SemanticLayers /ComfyUI/custom_nodes/ComfyUI-SemanticLayers

# Install every node's Python deps (incl. the vendored PuLID folder + Manager).
#
# One node's failure must not fail the whole build, so this stays non-fatal — but it is no
# longer SILENT. Under constraints.txt a node whose requirements.txt contradicts a floor
# now fails to resolve instead of quietly rewriting a package every other node shares. That
# is the trade: the shared base survives, and THAT node may be short a dependency. The `!!`
# summary is what tells you which one — so it must stay rare, which is what SKIP is for.
#
# SKIP = files we deliberately never install, so an EXPECTED failure never trains anyone to
# scroll past `!!`. Today that is `ComfyUI-PuLID-Flux2`, whose requirements.txt opens with
# upstream's own warning — "Do NOT run pip install -r requirements.txt if you already have a
# working ComfyUI" — and then pins `numpy<2.0.0` and `ml_dtypes==0.3.2`, the pair that shipped
# an image whose face stack could not import (2026-08-20). Everything it legitimately needs
# (insightface, onnxruntime-gpu, open-clip-torch, safetensors) is installed explicitly by the
# face-stack step above, which is exactly the install line upstream tells you to use instead.
RUN set -eu; \
    SKIP="$(python -c "import json;print(' '.join(json.load(open('/nodes.json')).get('skipRequirements', [])))")"; \
    failed=''; \
    for r in */requirements.txt; do \
        node="${r%/requirements.txt}"; \
        case " $SKIP " in \
            *" $node "*) echo "== skip: $r  (deliberate — see Dockerfile)"; continue;; \
        esac; \
        echo "== deps: $r =="; \
        pip install -r "$r" || failed="$failed $r"; \
    done; \
    if [ -n "$failed" ]; then \
        echo "!! node requirements FAILED:$failed"; \
        echo "!! Usually a pin that contradicts /constraints.txt. The shared dep base is"; \
        echo "!! intact (that is what the constraint is for) but those nodes may be short a dep."; \
    fi

# ComfyUI-Manager: security level "middle" so artists can add nodes from the web UI on a
# remote pod. Pre-seed its config in BOTH known locations (newer Manager reads
# user/default/ComfyUI-Manager/config.ini; older reads custom_nodes/ComfyUI-Manager/config.ini).
RUN mkdir -p /ComfyUI/user/default/ComfyUI-Manager && \
    printf '[default]\nsecurity_level = middle\n' | tee \
        /ComfyUI/user/default/ComfyUI-Manager/config.ini \
        /ComfyUI/custom_nodes/ComfyUI-Manager/config.ini > /dev/null

# --- dependency sanity (MUST be after the LAST pip step) ---------------------------
# The requirements loop above is non-fatal, so one node's stale pin can still leave the
# image in a state the build itself is happy with. Three checks, because they catch
# different things:
#
#   `pip check` — METADATA conflicts, advisory (`|| true`). This image carries long-standing
#   benign overlaps (three opencv distributions sharing the `cv2` namespace), and failing on
#   those would block every build for a condition nobody is fixing today. Read it in the log.
#
#   verify-deps.py IMPORTS — and it FAILS the build. This is the one that catches an ABI
#   break, which pip check cannot see: onnx declares `ml_dtypes` with no version bound, so
#   0.3.2 resolved clean and only fell over at import (2026-08-20).
#
#   verify-deps.py TORCH BUILD — also fatal, and it is the guard that replaces "torch must
#   be the last pip step". Ordering used to make the cu128 build unclobberable; now
#   constraints.txt does, and this asserts the result rather than trusting either.
COPY tools/verify-deps.py /verify-deps.py
RUN pip check || true
RUN python /verify-deps.py

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

# The R2 model mirror, both directions, at the paths the runbook names. NOT in this
# folder in git — CI copies them in from services/atlas-tool/runpod/ (see the workflow),
# because Docker COPY cannot escape the build context and a second tracked copy is how a
# vendored file drifts. `pull` fills a fresh volume from R2; `push` is the only way a
# model BORN on a pod — a trained LoRA — ever reaches a desktop or the serverless worker.
COPY tools/pull-models.py /pull-models.py
COPY tools/push-models.py /push-models.py

# --- Entrypoint -------------------------------------------------------------------
WORKDIR /
COPY extra_model_paths.yaml /ComfyUI/extra_model_paths.yaml
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8188
# Auto-starts ComfyUI on 8188 and keeps the container alive → NO RunPod "Container Start
# Command" is needed. A ComfyUI crash never takes the container down (see start.sh).
CMD ["/start.sh"]
