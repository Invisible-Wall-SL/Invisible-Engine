#!/usr/bin/env bash
# Launch ComfyUI in the background, then run the serverless handler in the foreground
# (the handler waits for ComfyUI to answer before accepting jobs).
set -e

echo "worker: starting ComfyUI…"
python -u /ComfyUI/main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch \
    > /comfy.log 2>&1 &

echo "worker: starting serverless handler…"
exec python -u /handler.py
