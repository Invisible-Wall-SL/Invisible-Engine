# ComfyUI (cloud R&D) — status

> Design: [docs/design/runpod-comfyui-backend.md](../design/runpod-comfyui-backend.md) · Infra/runbook: [docs/INFRA.md](../INFRA.md) "ComfyUI R&D pod (RunPod)" · Guide: [docs/tools/comfyui.md](../tools/comfyui.md) · Agents: `.claude/agents/launcher-studio.md` (the card) + `.claude/agents/atlas-python-tools.md` (the pod/backend)

**One-line state:** `/comfyui` is a full **pod control panel** — live status + Start / Open / Stop of the RunPod GPU pod, with admin-configured idle auto-stop. Pod deploy + env (`COMFY_RND_URL`, `RUNPOD_API_KEY`, `RUNPOD_POD_ID`) are owner-side.

## Current state
- **`/comfyui` control panel** (id `comfyui`, third-party name "ComfyUI") — full-page, no iframe, renders the shared `ToolTopBar`. Polls `/comfyui/status` (~5s) for live pod state and renders one of three shapes:
  - **Not configured** (`COMFY_RND_URL` unset) → a "set `COMFY_RND_URL`" landing.
  - **Open-link only** (URL set, RunPod secrets unset → `podControlConfigured()` false) → a plain **Open ComfyUI ↗** button, no Start/Stop.
  - **Full control panel** (URL + `RUNPOD_API_KEY` + `RUNPOD_POD_ID`) → live status + **Start pod** (RunPod GraphQL `podResume`, "warming up ~2 min", surfaces "GPU unavailable → Retry start" on failure), **Open ComfyUI ↗** (new tab, once `comfyReady`), and **Stop pod** (`podStop`).
- **Endpoints:** `status`, `start`, `stop`, `ping` under `(app)/comfyui/` (all `requireComfyAccess`). While the tab is visible it heartbeats `ping` (~60s) to keep the pod alive; closing the tab does NOT stop the pod.
- **Idle auto-stop** — a launcher watchdog stops the pod after N idle minutes when ComfyUI's queue is empty. Admin-configured (NOT env): Admin → Settings → "ComfyUI R&D pod" → enable toggle + idle minutes (default 20), stored in `app_settings` (`runpodIdleEnabled` / `runpodIdleMinutes`). The panel shows "Auto-stops after N min idle" when on.
- It does NOT auto-redirect (the pod is on-demand and may be stopped, so a bare redirect would dump the artist on a RunPod error page).
- Access: `admin`, `developer`, `artist` (`ROLE_TOOLS`). Placed in the **Assets** stage of the tool bar, next to the Atlas Maker.
- Purpose: an artist runs GPU-heavy ComfyUI R&D on the pod (their laptop OOMs), then exports the network as an **Atlas Maker blueprint** ([blueprints §3](../design/invisible-blueprints.md)).

## Open items / next
1. **Live-verify the control panel** end-to-end: as an artist → `/comfyui` → Start → wait for ready → Open → Stop; and confirm idle auto-stop reclaims the GPU after the admin-set window with an empty queue.
2. **Node/model parity** — a custom node or model used in R&D must also exist on the Atlas Maker's generation backend (custom nodes are baked into the serverless worker image; models live on the volume + mirrored to R2) or the resulting blueprint won't run. Tighten this workflow so an R&D blueprint reliably runs in the Atlas Maker afterward.

## Recent changes
- 2026-08-13 — **Pod lifecycle control shipped.** `/comfyui` went from a link-out landing to a full control panel: live status polling + Start/Open/Stop, tab heartbeat, "GPU unavailable → Retry" handling, and admin-configured idle auto-stop (`app_settings`). New `status`/`start`/`stop`/`ping` endpoints + `$lib/server/runpod` (`podResume`/`podStop`/`podStatus`/`comfyReady`/`podControlConfigured`) and `runpodActivity`. Env adds `RUNPOD_API_KEY` + `RUNPOD_POD_ID`. Infra runbook (pod start-command, cu128 torch, `v0.3.66` pin) captured in [docs/INFRA.md](../INFRA.md) "ComfyUI R&D pod (RunPod)". Guide (`docs/tools/comfyui.md`) updated to the control-panel UX.
- 2026-08-13 — **`/comfyui` card shipped.** Registry entry + icon + Assets-stage placement (`roles.ts`), `COMFY_RND_URL` env getter (`env.ts`), the route (`(app)/comfyui/+page.{server.ts,svelte}`), the guide (`docs/tools/comfyui.md`) + README row.
