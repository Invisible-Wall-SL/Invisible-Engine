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

echo "== 1/5  ComfyUI ($COMFYUI_REF) + ComfyUI-Manager =="
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

echo "== 2/5  Custom nodes required by the SDXL/FLUX blueprints =="
clone_node() {
	local url="$1" dir="$NODES/$2" ref="${3:-}"
	if [ -z "$ref" ]; then
		[ -d "$dir" ] || git clone --depth 1 "$url" "$dir"
		return
	fi
	[ -d "$dir" ] || git clone "$url" "$dir"
	# An earlier run's `--depth 1` clone cannot see the pinned commit; deepen it first.
	# Checking out the commit it already sits at is a no-op, so a re-run is safe.
	[ ! -f "$dir/.git/shallow" ] || git -C "$dir" fetch --quiet --unshallow
	git -C "$dir" checkout --quiet "$ref"
}
clone_node https://github.com/cubiq/ComfyUI_IPAdapter_plus ComfyUI_IPAdapter_plus
# Pinned with nodes.json: step 5's checksummed file list is the one this commit loads.
clone_node https://github.com/1038lab/ComfyUI-RMBG          ComfyUI-RMBG 9edb2bec3900
clone_node https://github.com/Fannovel16/comfyui_controlnet_aux comfyui_controlnet_aux

echo "== 3/5  Python deps =="
python -m pip install --upgrade pip
python -m pip install -r "$COMFY/requirements.txt"
python -m pip install boto3
# Custom-node deps (each may ship its own requirements.txt).
for req in "$NODES"/*/requirements.txt; do
	[ -f "$req" ] && python -m pip install -r "$req" || true
done

echo "== 4/5  Pull models from R2 =="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python "$SCRIPT_DIR/pull-models.py" --dest "$COMFY/models"

# ComfyUI-RMBG downloads these into models/RMBG/ on first use — on this volume, the
# folder every serverless worker shares, which is how one torn birefnet.py failed every
# cutout for 14 hours (2026-09-04). Fetched here instead, checksummed, before anything
# runs; the worker verifies the same checksums at boot and stages what passes.
# This legacy lane runs ComfyUI FROM the volume, so its node still writes the shared
# models/RMBG/ — never provision the serverless volume from a running legacy-lane ComfyUI.
echo "== 5/5  Background-removal weights (RMBG-2.0 + BiRefNet, checksummed) =="
FETCH=/fetch-models.py
[ -f "$FETCH" ] || FETCH="$SCRIPT_DIR/fetch-models.py"
if [ ! -f "$FETCH" ]; then
	echo "!! fetch-models.py not found at /fetch-models.py or beside this script." >&2
	echo "!! It lives in services/atlas-comfy-pod/tools/ — copy it next to provision.sh and re-run." >&2
	exit 1
fi
python "$FETCH" --set rmbg --set birefnet --dest "$COMFY/models"

# Drop the start script next to the volume root for convenience.
cat > "$ROOT/start-comfyui.sh" <<'EOF'
#!/usr/bin/env bash
cd /workspace/ComfyUI
exec python main.py --listen 0.0.0.0 --port 8188
EOF
chmod +x "$ROOT/start-comfyui.sh"

echo "== Done. Start ComfyUI with: bash /workspace/start-comfyui.sh =="
