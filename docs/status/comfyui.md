# ComfyUI (cloud R&D) — status

> Design: [docs/design/runpod-comfyui-backend.md](../design/runpod-comfyui-backend.md) · Guide: [docs/tools/comfyui.md](../tools/comfyui.md) · Agents: `.claude/agents/launcher-studio.md` (the card) + `.claude/agents/atlas-python-tools.md` (the pod/backend)

**One-line state:** Launcher card shipped (`/comfyui`) — a launcher-framed landing that opens an interactive ComfyUI on a RunPod GPU pod. Pod deploy + `COMFY_RND_URL` are owner-side.

## Current state
- **`/comfyui` launcher card** (id `comfyui`, third-party name "ComfyUI") — full-page, no iframe, renders the shared `ToolTopBar`. Reads `COMFY_RND_URL` (the pod proxy URL, `https://<podId>-8188.proxy.runpod.net`). When set → an **Open ComfyUI ↗** button (new tab) + the Build → Export (Save API Format) → Publish-as-blueprint guidance; when unset → a "set `COMFY_RND_URL`" state. It does NOT auto-redirect (the pod is on-demand and may be stopped, so a bare redirect would dump the artist on a RunPod error page).
- Access: `admin`, `developer`, `artist` (`ROLE_TOOLS`). Placed in the **Assets** stage of the tool bar, next to the Atlas Maker.
- Purpose: an artist runs GPU-heavy ComfyUI R&D on the pod (their laptop OOMs), then exports the network as an **Atlas Maker blueprint** ([blueprints §3](../design/invisible-blueprints.md)).

## Open items / next
1. **Owner: deploy the R&D pod** and set `COMFY_RND_URL` on the launcher Railway service — see the setup steps in [docs/design/runpod-comfyui-backend.md](../design/runpod-comfyui-backend.md) ("Owner setup"). The pod attaches the existing 250 GB Network Volume (ComfyUI + nodes + models already on it).
2. **Live-verify** the card once the pod is up: log in as an artist → `/comfyui` → Open → the pod's ComfyUI loads.
3. **Node/model parity** — a custom node or model used in R&D must also exist on the Atlas Maker's generation backend (custom nodes are baked into the serverless worker image; models live on the volume + mirrored to R2) or the resulting blueprint won't run. Tighten this workflow so an R&D blueprint reliably runs in the Atlas Maker afterward.

## Recent changes
- 2026-08-13 — **`/comfyui` card shipped.** Registry entry + icon + Assets-stage placement (`roles.ts`), `COMFY_RND_URL` env getter (`env.ts`), the route (`(app)/comfyui/+page.{server.ts,svelte}`), the guide (`docs/tools/comfyui.md`) + README row. Build bundles clean; owner-side pod deploy + live-verify owed.
