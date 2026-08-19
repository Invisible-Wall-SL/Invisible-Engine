#!/usr/bin/env bash
# One-time provisioning for a RunPod ComfyUI pod backed by a Network Volume at
# /workspace. Idempotent: safe to re-run. See README.md in this folder.
set -euo pipefail

ROOT=/workspace
COMFY="$ROOT/ComfyUI"
NODES="$COMFY/custom_nodes"

# Keep in lockstep with services/atlas-comfy-pod and services/atlas-serverless — a pod
# provisioned off master would run a different core than the images do.
COMFYUI_REF="${COMFYUI_REF:-v0.33.1}"

echo "== 1/4  ComfyUI ($COMFYUI_REF) + ComfyUI-Manager =="
if [ ! -d "$COMFY" ]; then
	git clone --branch "$COMFYUI_REF" --depth 1 https://github.com/comfyanonymous/ComfyUI "$COMFY"
fi
mkdir -p "$NODES"
if [ ! -d "$NODES/ComfyUI-Manager" ]; then
	git clone --depth 1 https://github.com/Comfy-Org/ComfyUI-Manager "$NODES/ComfyUI-Manager"
fi

# Manager MUST be at security level "middle" (or lower) or the blueprint model
# auto-install (/manager/queue/install_model, /reboot) returns 403.
MGR_CFG_DIR="$COMFY/user/default/ComfyUI-Manager"
mkdir -p "$MGR_CFG_DIR"
if [ ! -f "$MGR_CFG_DIR/config.ini" ]; then
	printf '[default]\nsecurity_level = middle\n' > "$MGR_CFG_DIR/config.ini"
else
	# Force the level even if a config already exists.
	if grep -q '^security_level' "$MGR_CFG_DIR/config.ini"; then
		sed -i 's/^security_level.*/security_level = middle/' "$MGR_CFG_DIR/config.ini"
	else
		printf 'security_level = middle\n' >> "$MGR_CFG_DIR/config.ini"
	fi
fi

echo "== 2/4  Custom nodes required by the SDXL/FLUX blueprints =="
clone_node() {
	local url="$1" dir="$NODES/$2"
	[ -d "$dir" ] || git clone --depth 1 "$url" "$dir"
}
clone_node https://github.com/cubiq/ComfyUI_IPAdapter_plus ComfyUI_IPAdapter_plus
clone_node https://github.com/1038lab/ComfyUI-RMBG          ComfyUI-RMBG
clone_node https://github.com/Fannovel16/comfyui_controlnet_aux comfyui_controlnet_aux

echo "== 3/4  Python deps =="
python -m pip install --upgrade pip
python -m pip install -r "$COMFY/requirements.txt"
python -m pip install boto3
# Custom-node deps (each may ship its own requirements.txt).
for req in "$NODES"/*/requirements.txt; do
	[ -f "$req" ] && python -m pip install -r "$req" || true
done

echo "== 4/4  Pull models from R2 =="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python "$SCRIPT_DIR/pull-models.py" --dest "$COMFY/models"

# Drop the start script next to the volume root for convenience.
cat > "$ROOT/start-comfyui.sh" <<'EOF'
#!/usr/bin/env bash
cd /workspace/ComfyUI
exec python main.py --listen 0.0.0.0 --port 8188
EOF
chmod +x "$ROOT/start-comfyui.sh"

echo "== Done. Start ComfyUI with: bash /workspace/start-comfyui.sh =="
