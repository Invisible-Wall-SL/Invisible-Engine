#!/usr/bin/env bash
# The handler OWNS the ComfyUI process — it starts it, waits for readiness, and
# restarts it between jobs (see handler.py). This script only prepares the models
# tree, then hands off. ComfyUI's stdout/stderr stream to the container log.
set -e

VOLUME_MODELS=/runpod-volume/ComfyUI/models

# cubiq PuLID (and some other nodes) resolve InsightFace/models from ComfyUI's
# DEFAULT models dir and ignore extra_model_paths.yaml. Point the models tree at the
# attached network volume so those nodes find the models we already have there
# (e.g. insightface/antelopev2) instead of auto-downloading a broken copy.
#
# ONE ENTRY AT A TIME, with models/RMBG left out. ComfyUI-RMBG keeps its weights AND
# the Python it execs beside them in models/RMBG/, downloads into that folder on first
# use, and rewrites its BiRefNet .py in place on every model load — so with the whole
# tree linked, every worker on the endpoint wrote into ONE shared folder, and a torn
# birefnet.py failed every cutout for 14 hours (2026-09-04). models/RMBG is this
# container's own directory instead: every file that verifies against the pinned
# checksums is staged into it from the volume, and anything that does not is left out
# for the node to download HERE, where no other worker can see it. Never fatal — a
# volume nobody has fetched to yet costs first-use downloads, not renders.
if [ -d "$VOLUME_MODELS" ]; then
    rm -rf /ComfyUI/models
    mkdir -p /ComfyUI/models
    for entry in "$VOLUME_MODELS"/*; do
        [ -e "$entry" ] || continue
        name="$(basename "$entry")"
        [ "$name" = RMBG ] && continue
        ln -s "$entry" "/ComfyUI/models/$name"
    done
    echo "worker: linked /ComfyUI/models/* -> $VOLUME_MODELS/* (RMBG is container-local)"
    if ! python -u /fetch-models.py --verify --set rmbg --set birefnet \
            --dest "$VOLUME_MODELS" --stage /ComfyUI/models; then
        echo "worker: !!! some background-removal weights on the volume did not verify (above)."
        echo "worker: !!! Each one is downloaded into THIS container on first use — slower, and"
        echo "worker: !!! paid again by every new worker, but never written to the shared volume."
        echo "worker: !!! Fix, on a pod: python /fetch-models.py --set rmbg --set birefnet"
    fi
else
    echo "worker: WARNING $VOLUME_MODELS not found — using baked (empty) models dir;"
    echo "worker: background-removal weights will download into this container on first use"
fi

echo "worker: starting handler (owns the ComfyUI lifecycle)…"
exec python -u /handler.py
