#!/usr/bin/env bash
# Launch ComfyUI in the background, then run the serverless handler in the foreground
# (the handler waits for ComfyUI to answer before accepting jobs). ComfyUI's stdout/
# stderr stream straight to the container log so any startup crash is visible in the
# RunPod worker logs.
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

echo "worker: starting ComfyUI…"
python -u /ComfyUI/main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch &

echo "worker: handler waiting for ComfyUI to become ready…"
exec python -u /handler.py
