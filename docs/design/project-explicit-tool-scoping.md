# Project-explicit tool scoping

> Status: **DRAFT / scoping** (2026-06-17). Owner-reported flaw: you can **edit one
> project and publish another** without any signal. Root cause below. Decision:
> make every tool bind to an **explicit** project, with the current project always
> visible — kill the invisible global context. Related: [[invisible-game-maker]].

## The flaw (a real incident)

Every in-launcher authoring tool resolves its project from a **single hidden
session value** — `sessions.activeProjectKey`, read via `getActiveScope(session)`
(`src/lib/server/auth.ts`). Seven routes follow it: `atlas`, `components`,
`editor`, `fonts`, `localization`, `sheet`, `symbols`. Meanwhile **Invisible Game
Maker publishes a project you click explicitly**.

Those two contexts can diverge with **no signal**:

> The owner edited scenes with the active project set to **Book of Borut**, then
> published **test1**. The edits saved to `borut/bookofborut/editor/scenes.json`
> (correctly — that was the active project); test1's doc was untouched since 3 days
> prior; the published test1 game faithfully served its *own* stale doc. Everything
> worked "correctly" and the result was still wrong, because the context driving
> edits was invisible and different from the context driving publish.

A context that drives outward/destructive actions (publish) or silent data writes
(save) must never be invisible or implicit. **This shouldn't be possible.**

## Decision — project-explicit (decouple)

Each tool binds to an **explicit project passed in the URL**, not the hidden
session scope. **Game Maker is the project hub**: you pick a project there, and
**Edit / author / Publish all launch scoped to THAT project** via `?project=`. The
current project is shown loudly in every tool. The footgun becomes structurally
impossible: you always launch a tool *from* a named project, and you always see
which one.

### How it works

1. **Shared resolver** — `resolveToolScope({ url, session })` in `$lib/server`:
   - If `url.searchParams.get('project')` is present: that project is
     **authoritative**. Resolve its client (DB), **sync it into the session**
     (`setActiveScope`) so every surface now agrees, and return `{clientKey,
     projectKey}`.
   - Else: fall back to `getActiveScope(session)` (today's behavior).
   This is **additive** — no `?project=` ⇒ byte-identical to today, so existing
   flows and the current selector keep working. The new safety only engages when a
   tool is launched with an explicit project (which the hub always does).
2. **All 7 tool routes** swap `getActiveScope(...)` → `resolveToolScope(...)`.
   `atlas`/`sheet` already forward `(client, project)` into the external tool URL,
   so an explicit `?project=` simply flows straight through to the Python tool.
3. **Game Maker = the hub.** Each project row gets actions that launch the tools
   scoped to that row's project: **Edit** → `/editor?project=<key>`, plus
   **Atlas / Fonts / Symbols / Localization** → `/<tool>?project=<key>`, and
   **Publish** (already explicit). One place to choose a project; everything you do
   next is bound to it.
4. **Loud current-project indicator** — `ToolTopBar` renders `<client> / <project>`
   prominently on every tool page. Even the fallback (no `?project=`) path is then
   never invisible. This is the "you can always SEE the target" guarantee.
5. **Publish confirmation** (cheap complement) — Game Maker's Publish shows the
   project name + its doc's **last-edited time** and asks to confirm. Decouple makes
   the wrong project structurally hard; the confirm makes the *right* one obvious
   ("publishing test1, scenes last edited 3 days ago — continue?") and catches a
   stale publish.

### Why additive + fallback (not a hard cutover)

Ripping out the global active scope entirely would touch the selector, the home
page, and every tool at once. Keeping `getActiveScope` as the fallback means the
change is incremental and low-risk: ship the resolver + hub links, and a tool
opened the old way still works. The global selector can later be demoted to "the
default when you didn't launch from a project," or removed, once the hub is the
habit.

## Build plan (phased)

1. **Resolver + routes** — `resolveToolScope()` + swap it into the 7 tool routes.
   Pure additive; `pnpm --filter launcher-api build` green. No visible change until
   a `?project=` is passed.
2. **Game Maker hub** — per-project action links (`Edit`/`Atlas`/`Fonts`/…
   `?project=`) + the Publish confirmation (project + last-edited). This is the
   surface that makes the model real.
3. **Loud indicator** — `ToolTopBar` shows `<client> / <project>` on every tool.
4. **(Later) demote the global selector** — once launching-from-hub is the norm,
   decide whether the standalone selector stays as a convenience or is removed.

## Files

- `src/lib/server/auth.ts` — `getActiveScope` / `setActiveScope` (reuse; add nothing
  destructive). New resolver may live here or in a small `$lib/server/toolScope.ts`.
- `src/routes/(app)/{atlas,components,editor,fonts,localization,sheet,symbols}/+page.server.ts`
  — use `resolveToolScope`.
- `src/routes/(app)/game-maker/+page.svelte` (+ `+page.server.ts`) — hub action links
  + publish confirm + each project's `scenes.json` last-edited time in the loader.
- `src/lib/ToolTopBar.svelte` — prominent current-project label.

## Open questions

1. **Sync-to-session on explicit `?project=`** (recommended yes): launching a tool
   for project X sets X as the session active project, so the whole UI agrees and a
   later tool opened without a param continues on X. Alternative (purer decouple):
   never touch the session — each page is independent — but then the top-bar/global
   selector can still show a different project than the page. Recommend sync.
2. **Scope of hub actions** — which tools get per-project launch links in v1 (at
   least Edit + Publish; Atlas/Fonts/Symbols/Localization are easy adds).
3. **Selector's future** — keep as default-context convenience, or retire once the
   hub is established (defer).
