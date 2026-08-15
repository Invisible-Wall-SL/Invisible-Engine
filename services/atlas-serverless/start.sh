#!/usr/bin/env bash
# The handler OWNS the ComfyUI process — it starts it, waits for readiness, and
# restarts it between jobs (see handler.py). This script only prepares the models
# symlink, then hands off. ComfyUI's stdout/stderr stream to the container log.
set -e

# cubiq PuLID (and some other nodes) resolve InsightFace/models from ComfyUI's
# DEFAULT models dir and ignore extra_model_paths.yaml. Point the whole models tree
# at the attached network volume so those nodes find the models we already have there
# (e.g. insightface/antelopev2) instead of auto-downloading a broken copy.
if [ -d /runpod-volume/ComfyUI/models ]; then
    rm -rf /ComfyUI/models
    ln -s /runpod-volume/ComfyUI/models /ComfyUI/models
    echo "worker: linked /ComfyUI/models -> /runpod-volume/ComfyUI/models"
else
    echo "worker: WARNING /runpod-volume/ComfyUI/models not found — using baked (empty) models dir"
fi

echo "worker: starting handler (owns the ComfyUI lifecycle)…"
exec python -u /handler.py
