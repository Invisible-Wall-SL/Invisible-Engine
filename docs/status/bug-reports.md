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
  viewer cannot open is hidden (404, like a bug that does not exist); admins see all, and a
  reporter always sees their own. `project_key` has no foreign key on purpose: a bug naming a
  deleted or purged project keeps the key, so it stays an admin's (and its reporter's). Triage
  (priority, status, send / take back) is one capability per card — `pipelineBugTriage` ("Triage
  pipeline bugs") and `gameBugTriage` ("Triage game bugs"), **default admin, developer, Pipeline
  Tester** — so each card is granted on its own. Admin › Roles shows each card with its triage
  capability in a group of its own (**Pipeline bug reports**, **Game bug reports**), and Admin ›
  Users sets the same four per user: the two triage capabilities are the only capabilities set per
  user (`USER_CAPABILITIES`; the rest are admin-grade and stay per role). Pipeline Bug Reports sits
  in the launcher's **Pipeline** section, Game Bug Reports in **Create**. Editing the text: reporter or triager, pinned to the revision opened (409 when
  someone edited meanwhile). Comments: anyone who sees the bug. Screenshots: anyone who sees it
  adds; its uploader, the reporter or a triager removes.
- **Game bugs.** `/game-bugs` is scoped like every project tool (`resolveToolScope`: the `?project=`
  the user can open, else the session's) and lists that project's game bugs only. A game bug must
  name its project (a DB check), uses the game's parts as areas (gameplay, wins, features, art, UI,
  text, sound, loading, other), is never sent to Pipeline Changes (400), and its fix brief asks for a
  fix in that project's own content alone — never the engine, a tool, a template or another
  project. Purging a project deletes its game bugs in the same transaction as the row
  (`deleteProject`) and then their screenshots (`deleteBugScreenshots`); a pipeline bug that named
  the project keeps its report and the key (admins and its reporter only). A game bug's edit
  cannot change its project (400).
- **Automatic status (pipeline bugs only).** A pull request into `main` from this repository that
  names `BUG-<n>` in its title or branch (not its description: mentions in passing) is linked:
  opened → Working on (an Open bug), merged → Resolved (an Open or Working on bug), closed unmerged
  → back to Open only when a pull request had set Working on and no other linked one is open. A
  pull request that stops naming the bug, or that GitHub no longer has, is unlinked (as if closed
  unmerged); one first seen already closed before the bug was reported moves nothing. Only a
  _change_ of a link moves a status, so a status set by hand stays. Run at most once a minute in
  the background of a list request — the page answers with the last result, never waits on GitHub
  (but the first read after a restart): open pulls, the last 100 closed, and links still open read
  by number, longest-unread first. Off with a sentence until the GitHub App is configured; a GitHub
  failure is a state, never an error. Recorded in the activity as **GitHub** (no person). Game bugs
  are never linked.
- **Pipeline Changes.** A new **Bugs** tab (`/pipeline?tab=bugs`) lists the pipeline bugs sent
  there, still to do first (Resolved / Won't fix folded under **Done**), with their linked pull
  requests (an open one opens in the Changes tab) and **Copy fix brief**; a change card shows a
  `BUG-<n>` tag when its title or branch names one (the description links too, but has no tag).
- **A link to the other list** (a game bug on `/bugs`, another project's game bug) is not opened
  there: the page names the list it belongs to, with **Open it there**.
- **Report bug on every tool.** The shared `ToolTopBar` (and its four HTML twins) shows **Report
  bug** to whoever has Pipeline Bug Reports, on every tool but the two bug tools: it opens
  `/bugs?new=1&for=<tool id>&page=<address>`, the form with the tool and the page filled in
  (`reportBugHref`). The game page's **Game** picker opens another project's list from the one
  Create card.
- **Fixture:** `pnpm --filter launcher-api check:bug-reports` (run by `check:all`) — the real
  modules with the database, R2, grants, tool scope and GitHub faked at their seams.

## Open items / next

1. **Browser pass** on the live launcher: report with pasted / dropped screenshots, filters and the
   address round trip, triage, the lightbox, the game page across a project switch in the top bar,
   the Pipeline Changes Bugs tab. Nothing here has been clicked yet.
2. **Move a game bug to the pipeline list** when the cause turns out to be in the engine or a tool
   (today: report a new pipeline bug and mark the game bug Won't fix).
3. No delete of a bug report (Won't fix is the way out); no assignee field.

## Recent changes

- 2026-10-26 — **Report bug on every tool** (same PR): the shared `ToolTopBar` and its four HTML
  twins (Rigger, Rig Viewer, Atlas Maker, Sheet Maker) carry **Report bug**, opening Pipeline Bug
  Reports' form with the tool filled in and the page without its query (an external tool's can
  carry a launch token) — `reportBugHref` in `$lib/toolLinks.ts`; `check:toolbar-icons` now also
  pins each twin's button. The game page has a **Game** picker, so the one Create card opens any
  game's list.
- 2026-10-26 — **Owner's layout** (same PR): Game Bug Reports moved to the Create section; triage
  split per card (`pipelineBugTriage`, `gameBugTriage`); both cards and both triage capabilities
  in their own groups in Admin › Roles and settable per user in Admin › Users.
- 2026-10-26 — **Review fixes** (same PR): links from title/branch only; a pull request closed
  before the bug was reported moves nothing; unlinking when a pull request stops naming the bug;
  pipeline bugs only; lists never wait on GitHub; a game bug's project is fixed; per-file upload
  errors no longer invite a duplicate report; `project_key` without a foreign key so a purged
  project's pipeline bugs stay restricted; reporters see their own bugs; `Object.hasOwn` areas;
  wrong-list links, conflict reload, scoped paste, exact `BUG-<n>` / `#PR` search.
- 2026-10-26 — **Built: Invisible Pipeline Bug Reports + Invisible Game Bug Reports** on one set of
  modules (`kind` column), a triage capability, the Pipeline Changes Bugs tab, automatic
  status from pull requests naming `BUG-<n>`, and `check:bug-reports`. Game bugs were added on the
  owner's ask mid-build: a separate card per project, its own list, a fix prompt about the game only.
