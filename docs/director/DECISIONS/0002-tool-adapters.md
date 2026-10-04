# ADR-0002 — Tool adapters

- **Status:** proposed
- **Date:** 2026-10-04

## Context

Agents act only through adapters onto the platform's own tools: Game Maker (create / duplicate /
read), Atlas Maker, ComfyUI, Rigger, Flipbook, Symbols SM, Scene Editor, Win Text, Localization and
Font Maker.

How the platform is reached today (ARCHITECTURE §1.4):
- **Launcher tools:** SvelteKit form actions and `/api/*` routes. They are session-cookie gated and
  every write is conditional (`baseEtag` → `If-Match`, 409 on conflict).
- **Atlas Maker:** a separate Python service. It is gated by a launcher-signed `iw_launch` token and
  answers routes such as `/render`, `/save`, `/createatlas`, `/deployatlas` and `/progress`.
- **ComfyUI / RunPod:** stills are submitted and polled every 2 s *inside* the atlas-tool render
  subprocess. Only video has a resumable queue.

## Options

1. **Agents call the existing browser endpoints with a service user's session.**
   - Cheapest, but the form actions are UI-shaped.
   - Permissions would ride on a fake human role.
2. **A thin adapter API in the launcher.** Routes live at `/api/director/adapter/<tool>/<op>`. Each is
   a typed operation that calls the **same server-side storage modules** the tool pages use
   (`symbolsStorage`, `winText` storage, `localization.ts`, `fontCatalog`, `projectDuplicate`, …).
   The atlas-tool is reached over its HTTP API with a minted launch token.
3. **Adapters as an MCP server.** This is the same as option 2, but exposed over MCP.

## Recommendation

**Option 2**, with each operation described by an MCP-compatible JSON schema so it could be served
over MCP later (see ADR-0001).

- **Auth.** The worker calls the launcher with `DIRECTOR_SERVICE_TOKEN` (a server env var) plus the
  `runId`.
  - The launcher resolves the run and checks the run's project scope (`requireProjectScope`) on every
    call.
  - It acts as the identity of the run's **owner**, so every write is attributed to them with
    `saved_by.tool = 'director'` and `agent = <name>`.
  - For Atlas Maker the launcher mints a short-lived `iw_launch` token for the run's project. The
    worker never holds a user cookie.
- **Per-agent permissions.**
  - Each agent's frontmatter `tools:` list is the allow-list. The worker passes only those tools to
    the model.
  - The adapter re-checks `agent ∈ allowed(op)` server-side, so a prompt can never widen it.
- **Hard refusals in code** (each has a test). These are not exposed as operations. The adapter layer
  also rejects any write whose target key is `config/config.json`, `published/**`, roles,
  `test_server/**`, or an agent definition:
  - publish
  - game-config write
  - roles / overrides
  - merge
  - pipeline branch writes
- **Locked items** are an explicit, read-only list on the run, taken from the template:
  - the math contract
  - the paytable
  - bet modes
  - paylines
  - feature rules
  - Scene-editor writes that touch nodes bound to math are rejected.
- **Idempotency.**
  - Every write op takes an `opId` (`runId:step:seq`). The launcher records `opId → result` in
    `director_ops`, so a replayed call after a crash returns the stored result.
  - Conditional writes (`baseEtag`) give conflict safety against humans editing the same project. On
    a 409 the adapter returns `conflict` to the agent, which re-reads. A human edit always wins.
- **GPU jobs: queue and resume, never poll from the model.**
  - `atlas.queue_variants` triggers `/render` and returns a `jobRef` immediately. The worker records
    the job and ends the agent's turn.
  - Completion is detected **in code, not by the model**. The worker's job watcher checks
    `/progress` and the manifest's new `batch/` variants on a backoff (no tokens spent). When the job
    finishes it appends a `job_done` tool-result message and wakes the agent.
  - A phase 2 task adds a completion callback from the atlas-tool, plus a resumable queue for stills
    that mirrors `video_runner.py`'s queue / lease / `resume_orphans`. That is a pipeline change to
    atlas-tool. Until then a lost still job is re-queued once by the watcher.
- **Writes follow `docs/design/multi-user-concurrency.md`.**
  - Read with the ETag, write with `If-Match`, use `putDocWithBackup` for whole-doc saves.
  - Python-side machine writes go through `_write_manifest_at`.

## Consequences

- A new route group `/api/director/adapter/*`, plus `director_ops` and a service-token gate (a new
  `check:` fixture).
- No changes to existing tools' behaviour. The adapters call their storage modules.
- One pipeline change to atlas-tool (render completion callback and a resumable still queue) in
  Phase 2.

## Needs owner approval

- Writes are attributed to the run's owner, marked `tool: director`.
- The atlas-tool change in Phase 2.
