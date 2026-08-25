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
# The VOLUME TEST LANE (see extra_model_paths.yaml). A node cloned into
# /workspace/ComfyUI/custom_nodes is loaded by ComfyUI and survives a container recreate —
# but its Python deps would not, because site-packages lives in the ephemeral container. So
# a second, volume-backed import root: `pip install --target /workspace/pysite <dep>` and it
# persists too. Created here rather than assumed, since ComfyUI listing a missing custom_nodes
# path is not worth risking on boot.
mkdir -p /workspace/ComfyUI/custom_nodes /workspace/pysite
export PYTHONPATH="/workspace/pysite${PYTHONPATH:+:$PYTHONPATH}"

cd /ComfyUI
nohup python main.py --listen 0.0.0.0 --port 8188 > /workspace/comfyui.log 2>&1 &

# RunPod will not expose ONE container port as both HTTP and TCP. We need both:
#   * TCP 8188  -> a direct http://<ip>:<port> the launcher can LINK to. The HTTP proxy
#                  403s any clicked link (Sec-Fetch-Site: cross-site), so the button is
#                  dead without this. See docs/INFRA.md.
#   * HTTP 8189 -> the proxy hostname, which is what the launcher's readiness probe and
#                  a pasted url use, and what works without a public IP.
# So serve ComfyUI on a second port too: forward 8189 -> 8188. Raw TCP, so ComfyUI's
# /ws progress socket passes through untouched. Configure the pod as
# "HTTP ports: 8189" + "TCP ports: 8188" and both paths work.
nohup python /port-forward.py > /workspace/port-forward.log 2>&1 &

exec sleep infinity
