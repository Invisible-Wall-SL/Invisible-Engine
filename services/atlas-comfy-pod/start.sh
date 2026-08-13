#!/usr/bin/env bash
# Interactive R&D pod entrypoint — crash-safe auto-start.
#
# Launch ComfyUI in the BACKGROUND and keep the container alive with `sleep infinity`,
# so a ComfyUI crash (bad node, OOM, torch import error) NEVER takes the container down
# or locks the artist out of the pod terminal (we lived this — a foreground ComfyUI that
# crashes kills the container, RunPod recreates it, and you can't get in to debug).
#
# ComfyUI's stdout/stderr stream to /workspace/comfyui.log (the volume) so startup
# crashes are visible from the pod terminal even after a restart: `tail -f /workspace/comfyui.log`.
#
# Because this auto-starts on 8188, NO RunPod "Container Start Command" is needed.
cd /ComfyUI
nohup python main.py --listen 0.0.0.0 --port 8188 > /workspace/comfyui.log 2>&1 &
exec sleep infinity
