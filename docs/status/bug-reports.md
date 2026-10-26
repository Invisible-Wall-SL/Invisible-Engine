# Bug Reports (Pipeline + Game) — status

> Guides: [docs/tools/pipeline-bugs.md](../tools/pipeline-bugs.md) · [docs/tools/game-bugs.md](../tools/game-bugs.md) · Agent: none yet (launcher tools — closest owner `.claude/agents/launcher-studio.md`)

**One-line state:** built 2026-10-26, not yet browser-verified — two launcher cards on one set of
modules: **Invisible Pipeline Bug Reports** (`/bugs`) for bugs in a tool, the engine or the
launcher, sent to Pipeline Changes to be fixed; **Invisible Game Bug Reports** (`/game-bugs`) for
one project's own game bugs, fixed in that project.

## Current state

One module, two kinds. A bug row carries `kind` (`pipeline` | `game`); everything else — tables,
server module, routes, page components, triage, screenshots, the pull-request link sync — is shared.

- **Where the code is.** Vocabularies, the `BUG-<n>` reference, the automatic-status rule and the
  fix brief: `apps/launcher-api/src/lib/bugReports.ts`. Access, validation, screenshots, the GitHub
  sync: `src/lib/server/bugReports.ts`. Postgres (the one seam the fixture replaces):
  `src/lib/server/bugReportsStore.ts`. The page for both tools: `src/routes/(app)/bugs/BugTracker.svelte`
  (+ `BugPanel`, `ReportForm`, `ShotDrop`, `view.ts`); `/bugs` and `/game-bugs` are thin routes that
  render it with their kind. API: `/api/bugs` (`?kind=pipeline` / `?kind=game&project=`),
  `/api/bugs/<n>`, `/api/bugs/<n>/screenshots[/<id>]`, `/api/pipeline/bugs`.
- **Storage.** Tables `bug_reports`, `bug_report_screenshots`, `bug_report_events` (append-only
  activity), `bug_report_links` (pull requests that name a bug), migration `0032_bug_reports`.
  Screenshots in R2 at `_bugs/<number>/<id>.<png|jpg|webp>`, written create-only and served only
  through their row. One numbering for both kinds.
- **Access.** Tools `pipelineBugs` and `gameBugs`, both on every role by default; each kind needs
  its own tool, and a bug of a kind the viewer lacks reads as no bug. A bug naming a project the
  viewer cannot open is hidden (404, like a bug that does not exist); admins see all. Triage
  (priority, status, send / take back) is the `bugTriage` capability — **default admin, developer,
  Pipeline Tester**. Editing the text: reporter or triager, pinned to the revision opened (409 when
  someone edited meanwhile). Comments: anyone who sees the bug. Screenshots: anyone who sees it
  adds; its uploader, the reporter or a triager removes.
- **Game bugs.** `/game-bugs` is scoped like every project tool (`resolveToolScope`: the `?project=`
  the user can open, else the session's) and lists that project's game bugs only. A game bug must
  name its project (a DB check), uses the game's parts as areas (gameplay, wins, features, art, UI,
  text, sound, loading, other), is never sent to Pipeline Changes (400), and its fix brief asks for a
  fix in that project's own content alone — never the engine, a tool, a template or another
  project. Purging a project deletes its game bugs in the same transaction as the row
  (`deleteProject`) and then their screenshots (`deleteBugScreenshots`); a pipeline bug that named
  the project keeps its report with no project.
- **Automatic status.** A pull request into `main` from this repository that names `BUG-<n>` in its
  title, branch or body is linked: opened → Working on (an Open bug), merged → Resolved (an Open or
  Working on bug), closed unmerged → back to Open only when a pull request had set Working on and no
  other linked one is open. Only a *change* of a link moves a status, so a status set by hand stays.
  Read on a list request at most once a minute (open pulls, the last 100 closed, and any link still
  open read by number); off with a sentence until the GitHub App is configured; a GitHub failure is
  a state, never an error. Applies to both kinds.
- **Pipeline Changes.** A new **Bugs** tab (`/pipeline?tab=bugs`) lists the pipeline bugs sent
  there, still to do first, with their linked pull requests (an open one opens in the Changes tab)
  and **Copy fix brief**; a change card shows a `BUG-<n>` tag when its title or branch names one.
- **Fixture:** `pnpm --filter launcher-api check:bug-reports` (run by `check:all`) — the real
  modules with the database, R2, grants, tool scope and GitHub faked at their seams.

## Open items / next
1. **Browser pass** on the live launcher: report with pasted / dropped screenshots, filters and the
   address round trip, triage, the lightbox, the game page across a project switch in the top bar,
   the Pipeline Changes Bugs tab. Nothing here has been clicked yet.
2. A **"Report a bug" entry in every tool** (the shared `ToolTopBar` and its four HTML twins)
   opening `/bugs?new=1&for=<tool id>&page=<address>` — the form already takes those; the entry
   point is not built.
3. **Move a game bug to the pipeline list** when the cause turns out to be in the engine or a tool
   (today: report a new pipeline bug and mark the game bug Won't fix).
4. No delete of a bug report (Won't fix is the way out); no assignee field.

## Recent changes
- 2026-10-26 — **Built: Invisible Pipeline Bug Reports + Invisible Game Bug Reports** on one set of
  modules (`kind` column), the `bugTriage` capability, the Pipeline Changes Bugs tab, automatic
  status from pull requests naming `BUG-<n>`, and `check:bug-reports`. Game bugs were added on the
  owner's ask mid-build: a separate card per project, its own list, a fix prompt about the game only.
