# Per-user ComfyUI routing — Design

> **Intent (owner, 2026-08-11):** the Atlas Maker is a UI over ComfyUI; ComfyUI runs
> **locally on each user's machine**, and the tool should send each user's jobs to
> **their own** ComfyUI — not to one shared box.

## The problem this fixes
The atlas-tool is cloud-hosted (Railway). It reaches ComfyUI through a single
`COMFY_URL` env var → the owner's named Cloudflare tunnel `comfy.invisiblewall.org`
(`iw_common/comfy.py::comfy_url()`). The Invisible Launcher desktop only lets the
**admin** run that one tunnel (`tunnel-bundle` is `admin`-gated). So **every** user's
generation runs on the **owner's** GPU, regardless of who's logged in — and if the
owner's box is off, nobody can generate. That's drift from the intent above: a
cloud UI wired to one backend collapsed "each user's local ComfyUI" into "one shared
ComfyUI".

## Approach (Option A — per-user address, keyed by the logged-in user)
A **client** is shared by multiple users, so ComfyUI is keyed by the **user**, not
the client. Each user's desktop launcher (already authenticated as that user) runs a
tunnel to *its* local ComfyUI and **registers the address**; the atlas-tool routes
that user's jobs there, falling back to the shared `COMFY_URL` when a user hasn't
registered one (so nothing breaks during rollout).

### The per-user ComfyUI record (the contract)
Stored in R2 at **`_users/<user-slug>/comfy.json`** (private bucket, like the other
tool state):

```jsonc
{
  "url": "https://comfy-alice.invisiblewall.org",   // or a *.trycloudflare.com quick tunnel
  "cf_access_id": "…",       // optional — only for a named tunnel behind CF Access (a)
  "cf_access_secret": "…",   // optional
  "updated": "2026-08-11T…Z"
}
```

- **(a) Named tunnel per user:** stable `comfy-<user>.invisiblewall.org` + a
  per-user CF Access service token (auto-provisioned via the Cloudflare API — Tunnel
  + DNS + Access endpoints). `cf_access_*` set.
- **(b) Quick tunnel:** the launcher runs `cloudflared tunnel --url localhost:8188`,
  gets a random `*.trycloudflare.com` URL, and **re-registers it on each start**. No
  `cf_access_*`. Simpler; the URL rotates so the launcher must keep it fresh.

Same record shape + routing either way — (a)/(b) differ only in how `url`/`cf_*` are produced.

### User identity → the atlas-tool
The tool resolves `(client, project)` per request from `?client=`/`?project=` +
`iw_client`/`iw_project` cookies (`_resolve_context`). Add the user the same way:
`?user=<slug>` + an `iw_user` cookie, forwarded by the launcher's atlas handoff.

### Routing (the elegant part)
`comfy_url()`/`cf_headers()` already read env (`COMFY_URL`, `CF_ACCESS_CLIENT_ID/SECRET`).
So the tool doesn't need a new client path — the render **subprocess** just gets the
active user's values in its env:
- On a render, `ui_server` resolves the active user's record (R2) → `_run_cmd` sets
  `env["COMFY_URL"]` (+ `CF_ACCESS_CLIENT_ID/SECRET`) to the per-user values,
  overriding the inherited global. `batch_atlas` then talks to that user's ComfyUI.
- No record → the global `COMFY_URL` (shared tunnel) is left in place → current behavior.
- The tool's own in-process comfy calls (model-list dropdowns) resolve the same way
  (phase 2 — not needed for generation to route correctly).

### Register endpoint (launcher-api)
`POST /api/comfy/register` — authenticated as the user (the desktop launcher already
holds a session token). Body `{ url, cf_access_id?, cf_access_secret? }` → writes
`_users/<user-slug>/comfy.json` to R2. `GET`/`DELETE` to read/clear. The atlas
handoff link is extended to carry `?user=<slug>`.

## Security
- The `iw_user` value only chooses **which of the user's own tunnels** a job runs on.
  A forged id at worst routes your job to *someone else's own GPU* (their tunnel, up
  or not) — no data leak, no cross-tenant write (R2 stays keyed by client/project).
  Harden later by validating `iw_user` against the launcher session.
- `cf_access_*` live in the private R2 bucket the tool already reads — never in URLs
  or logs.

## Build plan (phased)
1. **Atlas-tool routing foundation** — read `?user=`/`iw_user` into the request
   context; `resolve_user_comfy_env(user)` reads `_users/<slug>/comfy.json` from R2;
   `_run_cmd` applies it to the render subprocess env; fall back to the global
   `COMFY_URL`. *(engine-side, safe: no record ⇒ no change. This doc's first PR.)*
2. **launcher-api register endpoint** + forward `?user=` in the atlas handoff + store
   the record in R2.
3. **Desktop launcher** (`Invisible-Wall-SL/invisible-launcher`, separate repo) — run
   the tunnel + call `/api/comfy/register` on start. **(b) quick tunnel first.**
4. **(a) named-tunnel auto-provisioning** — Cloudflare API orchestration
   (tunnel + DNS + Access token) per user; stable hostnames.
5. **In-process comfy calls per-user** (model-list dropdowns) + harden `iw_user` vs
   the session.

Phase 1 (engine) + 2 (launcher) + 3 (desktop, quick tunnel) make it work per-user;
4 upgrades to stable named tunnels; 5 hardens.
