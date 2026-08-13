#!/usr/bin/env bash
# Launch ComfyUI in the background, then run the serverless handler in the foreground
# (the handler waits for ComfyUI to answer before accepting jobs). ComfyUI's stdout/
# stderr stream straight to the container log so any startup crash is visible in the
# RunPod worker logs.
set -e

echo "worker: starting ComfyUI…"
python -u /ComfyUI/main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch &

echo "worker: handler waiting for ComfyUI to become ready…"
exec python -u /handler.py
