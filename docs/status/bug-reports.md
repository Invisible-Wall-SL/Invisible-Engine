# Bug Reports (Pipeline + Game) — status

> Guides: [docs/tools/pipeline-bugs.md](../tools/pipeline-bugs.md) · [docs/tools/game-bugs.md](../tools/game-bugs.md) · Agents: `.claude/agents/launcher-studio.md` (the tools), `.claude/agents/pipeline-triage.md` (fixing a pipeline bug)

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
- **Fixing a pipeline bug.** A pipeline bug's fix brief names the build agent to start with,
  `pipeline-triage` (ADR-0009 §2): it reproduces the bug, routes it to the owning tool agent through
  `docs/knowledge/owners.json`, and asks for a `bug-<n>-<slug>` branch (which the link sync below
  reads) and a `## Lesson` block in the fix pull request. A game bug's brief does not change.
- **Director.** A Director run's `run.request_pipeline_change` files a pipeline bug: the worker
  calls the launcher op `bugs.file_pipeline_bug` (`src/lib/server/director/ops/bugs.ts`, behind the
  adapter gate, coordinator only), which writes it through `createDirectorBug` and `insertBug` like
  any report. It is Open and not sent, so a triager still decides; the reporter is
  `Director run <id>` against the run owner's account (they see it as theirs); the area is
  Invisible Director and the page the run's Live run screen.
  - **What it shows.** It names the run's project, else its template, whichever the owner can
    open, and only then carries the request's text; when the owner can open neither it names no
    project and says only that a run filed it, with the run's page (which only the run's viewers
    open). So it never shows a project to someone without it. `BUG-<n>` / `bug-<n>` in the agent's
    text becomes `bug #<n>`, so a pull request echoing the title moves no other bug.
  - **Once per call, five per run.** The call's `opId` rides on the bug's `reported` event (hidden
    from the page), so a call replayed after a launcher crash between the insert and the gate's
    record answers the same bug. A run files at most 5 (`MAX_DIRECTOR_BUGS`), and a request that
    matches one of its still-open bugs is refused naming it.
  - The run's activity line names the bug, linked from the Live run feed; a turn settled after a
    pause writes it then. **Deploy the launcher before the worker:** a worker whose launcher does
    not serve the op yet starts no coordinator (`toolsFor`), so no run moves until the launcher
    catches up.
- **A link to the other list** (a game bug on `/bugs`, another project's game bug) is not opened
  there: the page names the list it belongs to, with **Open it there**.
- **Report bug on every tool.** The shared `ToolTopBar` (and its four HTML twins) shows **Report
  bug** to whoever has Pipeline Bug Reports, on every tool but the two bug tools: it opens
  `/bugs?new=1&for=<tool id>&page=<address>`, the form with the tool and the page filled in
  (`reportBugHref`). The game page's **Game** picker opens another project's list from the one
  Create card.
- **Fix runs (ADR-0013; back end 13A, workflow 13B, UI 13C).** A fix run is a GitHub
  Actions job in which Claude Code proposes a fix for a pipeline bug, and the launcher turns its
  proposal into a draft pull request. What exists:
  - **The job (13B, #1525).** `.github/workflows/bug-fix.yml`, dispatched by the App with
    `fix_run`. It reads the bug with an OIDC token (`scripts/bug-fix/collect.mjs brief`), checks
    out the run's base plus a pristine copy, and runs the pinned Claude Code CLI (2.1.311, sha512
    checked) headless. The prompt is `scripts/bug-fix/coordinator.md`: `pipeline-triage` → the
    owning agent → gates → `code-reviewer` → `result.json`. Then `collect.mjs result` diffs the
    workspace against the pristine copy and POSTs the result with the CLI's usage; the log shows one
    line. The CLI runs `--restricted` under `env -i`, with settings and agents from the pristine
    copy and the Bash sandbox on: no network, no read of the key, the pristine copy or the runner's
    own files, fail closed without bubblewrap. What later steps run (the pristine copy, the
    rendered settings, the CLI) and the key are root's, out of reach of the CLI's own file tools.
    `tsx` runs through its loader in the sandbox (`tsx-shim.mjs`). Step 5 refuses a change that
    copies the brief or a screenshot. Proved on the pinned CLI with a scripted fake model
    (`bug-fix-proof.yml`, `prove-cli.mjs`); pinned offline by `pnpm check:bug-fix-workflow`.
  - **Storage.** Table `bug_fix_runs` (migration `0037_bug_fix_runs`) and the `fix_run` event kind.
    One live run per bug (a partial unique index); one Actions run per fix run (unique `gh_run_id`).
    `reason` holds the launcher's own sentence and `summary` the run's words. `result_at` is the
    claim on a result: a lease renewed before every GitHub write, stale after 5 minutes.
  - **Who.** The capability `pipelineBugFix` ("Start fix runs on pipeline bugs", admin by default,
    per role or per user) **plus** `pipelineBugTriage`.
  - **Caps.** Admin › Settings: `PIPELINE_FIX_BUDGET_USD` (one run, $15), `PIPELINE_FIX_MONTHLY_USD`
    (the month's ceiling, $150; refuses new starts), `PIPELINE_FIX_MAX_LIVE` (2).
  - **Start.** `POST /api/bugs/<n>/fix-runs { requestId }`. Refused as `bug_closed`, `pr_open`,
    `fix_run_live`, `too_many_fix_runs`, `fix_budget_spent` or `request_id_reused`, and 503 without
    the App. An unsent bug is sent in the same transaction. The launcher then dispatches
    `bug-fix.yml` on `main` as the App, with one input (`fix_run`). A 403 or 404 ends the run
    `failed` with a sentence naming `docs/INFRA.md` (the App's Actions write, or no workflow yet).
    **Stop:** `POST /api/bugs/<n>/fix-runs/<id>/stop` cancels the Actions run and settles
    `cancelled` at once.
  - **The job's endpoints.** `/api/pipeline/fix-runs/<id>/{brief,screenshots/<sid>,result}` accept
    only a GitHub OIDC token (`githubOidc.ts`, node:crypto, audience `invisible-launcher-bug-fix`).
    The token must come from `bug-fix.yml` on `main`, dispatched by the App's bot, first attempt,
    environment `bug-fix`, and from the run bound to that fix run. Each endpoint answers only a live
    run's own bug.
  - **The result.** The launcher records spend first (`director_spend`, agent `bug-fix`, run
    `fix:<id>`, idempotent per model), then claims the result and checks the change
    (`bugFixRunsChange.ts`):
    - protected paths by ancestry against the base tree, and modes;
    - dependencies, lifecycle scripts and ratchets;
    - size and text only;
    - secrets on the added lines;
    - suppression comments and hidden characters;
    - the project's and client's keys and names in the public text;
    - the commit scope, and a passing gate.
    A change that breaks a rule ends `no_fix` (needs a person). One that passes is committed as the
    App on `base_sha` and opened as a draft PR, `bug-<n>-fix-<id>`, titled
    `<scope>: BUG-<n> <title>`. The link sync then moves the bug, as for any `bug-<n>` branch.
  - **Backstop.** Inside `syncBugLinks`, apart from the PR pass:
    - a run with no Actions run after 15 minutes → `failed`;
    - an Actions run that completed without a result → `failed` / `cancelled`;
    - any run past 90 minutes → `failed`;
    - a stalled commit → the PR is looked up first.
  - **Page data.** `BugDetail.fixRuns`, `fix` (`FixFacts`: `may`, `ready`, the first `refusal`),
    `canStartFix`, `escalatedFix` (a game bug's escalated pipeline bug's latest run, status and PR
    only), and the `fix_run` activity lines.
- **Start fix UI (ADR-0013 card 13C).** `FixRunControl.svelte` (button + run lines + Stop + File it)
  sits in the Triage card of `/bugs` and on each card of the Bugs tab; the decisions are pure
  functions in `routes/(app)/bugs/fixView.ts` (`fixControl`, `fixRunLine`, `fileSecondBugHref`),
  pinned by `check:bug-fix-runs`. **Hidden while the workflow is absent:** `bugFixWorkflow.ts`
  asks GitHub (as the App, Actions read) for `bug-fix.yml` and treats only an active workflow as
  ready; the answer is kept a minute (10 seconds when GitHub did not answer) and `FixFacts.ready`
  is false without it, or without the App. `GET /api/pipeline/bugs` now also returns `fix`
  (`FixTab`: `triage`, `may`, `ready`, per-bug runs and refusal). The report form reads `title`
  and `details` from the address. **Mark ready for review:** `POST
  /api/pipeline/changes/<n>/ready` (`markReadyForReview` in `pipelineMerge.ts`, GitHub's GraphQL
  `markPullRequestReadyForReview` as the App; `pipelineMerge`; 409 unless an open draft), a bar
  with the button above the merge bar of a draft change in Pipeline Changes; `check:pipeline-changes`.
- **Fixtures:** `pnpm --filter launcher-api check:bug-reports` and `check:bug-fix-runs` (both run
  by `check:all`). Each runs the real modules with the database, R2, grants, tool scope, GitHub and
  (for fix runs) the OIDC keys faked at their seams.

## Open items / next

1. **Browser pass** on the live launcher: report with pasted / dropped screenshots, filters and the
   address round trip, triage, the lightbox, the game page across a project switch in the top bar,
   the Pipeline Changes Bugs tab. Nothing here has been clicked yet.
2. **Move a game bug to the pipeline list** — back end done (ADR-0012 §3, Director card 9G):
   `POST /api/bugs/<n>/escalate` (game triage + the Pipeline Bug Reports tool) and a repair run's
   `bugs.escalate_game_bug` file one pipeline bug, relate the two (`bug_report_relations`) and show
   **Waiting on pipeline · BUG-n** (derived). The bug page has **Escalate to pipeline** (a small
   form in the new **Repair** card, triagers with the Pipeline Bug Reports tool).
3. No delete of a bug report (Won't fix is the way out); no assignee field.
4. **Start fix on a pipeline bug** (ADR-0013, Director PLAN Phase 10). The back end (13A) is
   built, the workflow (13B) is in #1525, and the UI (13C) is built. The owner's three setup
   steps are done. Still to come:
   - **#1525's merge.** It edits `.github/workflows/`, so its `current-games` fails by design; the
     owner merges it with the admin override. **Merging it turns Start fix on:** 13C shows the
     button as soon as GitHub has an active `bug-fix.yml`.
   - **The live spike (13B's acceptance).** After the merge: ADR §10's five cases on seeded test
     bugs, never a real report, $20 in total. A run can only start from `main` (the OIDC claims and
     the `bug-fix` environment both pin it), so this cannot happen before the merge. Until then the
     workflow is proved only against the scripted fake model.
   - **13C's browser pass** (see "Start fix UI" above).
   - **13D**, the pilot.

   Until then a pipeline bug is fixed from **Copy fix brief**. The fixture fakes the store, so the
   real SQL (the advisory lock, the conditional updates, the run-row lock on spend) is proved only
   by the migration applying in CI's `postgres-proofs`. A two-connection proof is still owed.

## Recent changes

- 2026-11-08 — **Start fix UI and Mark ready for review (ADR-0013 card 13C).** Start fix / Send
  and start fix, the run line (status, PR, Actions link, spend, Stop, a second bug's File it) on
  the Bugs tab and the `/bugs` Triage card; hidden until GitHub has `bug-fix.yml` and the App is
  set; the fix run of an escalated bug on the game bug's Repair card; Mark ready for review on a
  draft change. Fixtures: `check:bug-fix-runs` (page facts for each state, status and outcome),
  `check:pipeline-changes` (ready), `check:bug-reports` (report link). Not clicked in a browser.

- 2026-11-08 — **Fix runs, the workflow (ADR-0013 card 13B, #1525).** `bug-fix.yml` and
  `scripts/bug-fix/` (the coordinator prompt, the settings, `collect.mjs`, `apiKeyHelper`, the tsx
  shim). `pipeline-triage` now reads the brief from the path a fix run gives. Built beyond the ADR,
  from what the proof found on the pinned CLI:
  - `--restricted`, which starts no messaging socket;
  - `exec env -i`, so no parent process keeps the key;
  - the runner's own folder denied, since it holds the runner's credentials;
  - Grep and Glob scoped like Read;
  - no cache, because pnpm hard-links its store into `node_modules`;
  - the tsx shim, because tsx's CLI needs a Unix socket and the sandbox refuses all of them.

  Fixtures: `check:bug-fix-workflow`, with every rule broken by its own planted mutant, and
  `bug-fix-proof.yml` on a hosted runner (no secret, no model, no spend). The live five-case spike
  waits for the merge (open item 4).

- 2026-11-03 — **Fix runs, back end (ADR-0013 card 13A, #1512).** `bug_fix_runs` (migration
  0037), `fix_run` events, the `pipelineBugFix` capability, three Settings caps, Start / Stop,
  dispatch of `bug-fix.yml` through the App, GitHub OIDC verification, the brief, screenshot and
  result endpoints, the change checks and the App's draft PR, the backstop in the link sync, and
  spend rows.
  - **Built on top of the ADR**, after three reviews (App calls, concurrency, security):
    - a result lease with retries;
    - Stop settles at once, so no PR opens after it;
    - protected paths checked by ancestry against the base tree;
    - the launcher's own fix-run modules protected;
    - the secret scan on added lines only;
    - privacy on folded keys and names.
  - **Fixtures:** `check:bug-fix-runs` (98 checks, each guard tested with a planted mutant),
    `check:bug-reports` (`fix_run`, and a `bug-<n>-fix-<id>` branch moving the bug).

- 2026-10-27 — **Repair UI on the game bug (Director card 9G)**: the **Repair** card on
  `/game-bugs` (**Repair with Director**, **Escalate to pipeline**, the bug's repair runs, the
  derived labels, also on the list rows); `repair` and `escalated` activity lines in words; the
  pipeline side shows **Escalated from a game bug**. The game page load supplies the facts
  (`repair`, `pipelineAreas`). `escalationDescription` moved to `$lib/bugReports` so the Repair
  review shows the pipeline bug exactly as filed. Browser pass still open.

- 2026-10-27 — **Repair runs move the bug (Director card 9G)**: a repair run sets Open → Working on
  and puts it back unless fixed or touched; a fix reads **Fixed, waiting on publish**
  (`repairLabel`, derived from the last `repair` event) until Game Maker's next publish resolves it
  (`resolveFixedBugs`, by "Game Maker publish", with the snapshot id).

- 2026-10-27 — **Game bug escalation (Director card 9G, back end)**: `bug_report_relations`, the
  `escalated` / `repair` event kinds, `insertEscalation` (one transaction: pipeline bug, relation,
  an `escalated` event on each bug, game bug Open → Working on), the derived pipeline label on
  summaries and details, and a repair run's `bugs.get_game_bug` / `bugs.get_screenshot` /
  `bugs.escalate_game_bug`. Fixtures: `check:bug-reports`, `check:director-adapters`, `prove:turns` (29).

- 2026-10-27 — **Pipeline repair (Director PLAN 9C)**: new build agent `pipeline-triage`; the
  pipeline fix brief names it and the `bug-<n>-…` branch (was `fix/bug-<n>-…`); a Director run's
  pipeline-change request files an Open, unsent pipeline bug (`bugs.file_pipeline_bug`,
  `createDirectorBug`) and its activity line links `BUG-<n>`. Fixtures: `check:bug-reports`,
  `check:director-adapters`, `check:director-live`, the worker's `prove:turns` (28).

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
