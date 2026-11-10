# Bug Reports (Pipeline + Game) — status

> Guides: [docs/tools/pipeline-bugs.md](../tools/pipeline-bugs.md) · [docs/tools/game-bugs.md](../tools/game-bugs.md) · Agents: `.claude/agents/launcher-studio.md` (the tools), `.claude/agents/pipeline-triage.md` (fixing a pipeline bug)

**One-line state:** built 2026-10-26; the pipeline side's main path clicked through on the live
launcher on 2026-11-09 (ADR-0013 13D), the game side not yet — two launcher cards on one set of
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
    - protected paths by ancestry against the base tree, and modes. The launcher's own share is
      what judges, writes or merges the change: its fix-run code, Pipeline Changes' server and
      API, and the modules they import for a rule;
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

1. **The rest of the browser pass** on the live launcher. Clicked on 2026-11-09 (13D, pipeline
   side, as admin): the report form opened from the address (`for`, `page`), priority, Won't fix,
   Send to Pipeline Changes, editing the text, the Bugs tab, and the whole fix-run path (see Recent
   changes). Still owed: pasted / dropped screenshots and the lightbox, filters and the address
   round trip, comments, Take back, the game page across a project switch in the top bar, every
   game-bug surface, and any of it as a non-admin.
2. **Move a game bug to the pipeline list** — back end done (ADR-0012 §3, Director card 9G):
   `POST /api/bugs/<n>/escalate` (game triage + the Pipeline Bug Reports tool) and a repair run's
   `bugs.escalate_game_bug` file one pipeline bug, relate the two (`bug_report_relations`) and show
   **Waiting on pipeline · BUG-n** (derived). The bug page has **Escalate to pipeline** (a small
   form in the new **Repair** card, triagers with the Pipeline Bug Reports tool).
3. No delete of a bug report (Won't fix is the way out); no assignee field.
4. **Start fix on a pipeline bug** (ADR-0013, Director PLAN Phase 10) is live and piloted:
   13A–13D are done (the spike and the pilot are in Recent changes). What the pilot left, each its
   own pipeline change:
   - **The prompt now names the launcher's refusals** (2026-11-09, see Recent changes; protected,
     so the owner merges it). Not yet proved by a live run: each costs about $2, so that is the
     owner's call. `check:bug-fix-workflow` fails when the prompt or the Edit deny list drifts from
     `bugFixRunsChange.ts`'s own lists, or when the launcher gains a refusal sentence.
   - **Launcher code a run may still change, on purpose** (2026-11-10, see Recent changes): the
     shared modules the fix-run path only uses — `env.ts`, `db/`, `$lib/roles.ts`,
     `appSettings.ts` (the fix-run budget defaults), `costs/` (the spend), `http.ts`, `zip.ts`,
     the bug store and `server/bugReports.ts` — and the `(app)/pipeline/` pages. Protecting them
     would refuse most launcher fixes; a change there takes effect only once a person merges it.
     Widening the set is the owner's call. Four fix-run rules a one-line edit there would weaken
     (the 2026-11-10 review):
     - `canRunFixes` in `server/bugReports.ts` needs both capabilities;
     - `fixGlobals` in the same file holds the monthly cap and the live-run limit;
     - `appSettings.ts` holds the budget defaults and ceilings;
     - `roles.ts` says who has `pipelineMerge` and `pipelineBugFix`.

     A cheap middle path: move `canRunFixes`, `fixStartFacts`, `fixGlobals` and the fix-run
     settings getters into a `server/bugFix*.ts` module. The widened rule then covers them, and the
     bug store stays open.

     The review left two smaller gaps:
     - Routes are protected by folder, not URL. A route group (`api/(g)/pipeline/…`) or a renamed
       parameter (`bugs/[n]/fix-runs/`) serves the same URL. The merge capability check also sits
       in the routes, not in `mergeChange` or `revertMerge`.
     - A Windows 8.3 short name (`PIPELI~1.TS`) passes the path rules. It matters only on an NTFS
       checkout; Railway is Linux.
   - **A fix inside a vendored bundle still cannot pass CI on its own**: `check-vendored-bundles`
     fails until a person rebuilds the bundle (#1536). The run is now told not to commit one, and
     to ask in its summary for `pnpm --filter launcher-api build:<name>`. `rigger-fx.js` (650 KB)
     and `rigger-text.js` (578 KB) are each over the 400 KB cap alone; `invisible-rig.js` is
     302 KB, not 590–670 KB as first recorded, so a run could ship it beside a change under about
     98 KB. The prompt forbids that for now; allowing it is the owner's call.
   - The small items (the $0 spend, Check 2 on a draft, tag placeholders, "Post the result" after
     an early stop) are fixed: #1546 and #1547, in Recent changes.

   The fixture fakes the store, so the real SQL (the advisory lock, the conditional updates, the
   run-row lock on spend) is proved only by the migration applying in CI's `postgres-proofs`. The
   live runs have now exercised that SQL, but a two-connection proof is still owed.

## Recent changes

- 2026-11-10 — **A fix run can no longer change the code that judges, writes or merges it**
  (open item 4's protected-path gap; `bugFixRunsChange.ts`, launcher-studio). The launcher's rule
  covered only `src/lib/server/bugFixRuns*.ts`.
  - **How the set was chosen:** the imports of what validates the change (`bugFixRunsChange.ts`),
    what commits it (`bugFixRuns.ts`) and what merges it (`pipelineMerge.ts` and its route), walked
    to the end. The walk stops at shared infrastructure (open item 4 lists what stays open).
  - **Now refused**, 32 more tracked files (338 in all):
    - `src/lib/server/bugFix*.ts`, widened from `bugFixRuns*.ts`: adds `bugFixWorkflow.ts`;
    - `src/lib/server/pipeline*.ts`, Pipeline Changes' server: the merge gate (`deriveStatus`,
      `harnessFilesOf`), `CI_SKIP`, merge and revert, the current-games game list, and the agent
      definitions it writes as the App;
    - all of `src/routes/api/pipeline/`, not only `fix-runs/`;
    - `$lib/bugReports.ts`: the bug-reference rule on the title, and `bugBrief`'s framing;
    - `concurrency.ts`: it reads the base copies the `package.json`, ratchet and added-line rules
      compare against. 18 launcher modules use it, so a bug inside it is now a person's fix;
    - `githubApp.ts`: the App's credentials, used for every commit, PR, merge and revert;
    - from the code review:
      - `vite.config.js` and `svelte.config.js`: an alias can repoint any protected import;
      - `db/migrate.ts`: it picks the migrations folder and runs it at boot, which is why
        `drizzle/` is protected. The rest of `db/` stays open;
      - `check-pipeline-changes.ts` and `check-pipeline-games.ts`: Pipeline Changes' own
        fixtures, as the fix-run and bug fixtures already were;
    - **a source file beside a protected `.ts`**, or a file of the same name with no extension:
      - The extensions refused are `.js`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.jsx` and `.tsx`, in
        any case.
      - For an extensionless import, Vite 6.2 loads the exact name, then `.mjs`, then `.js`,
        before the `.ts`. Measured with the pinned Vite: the other siblings lose, and are refused
        alike.
      - So a new `concurrency.js`, or an extensionless `githubApp`, would have shipped in place of
        the protected file while the fixtures kept testing the `.ts`. This held for every `.ts`
        entry, `untrusted.ts` included.
      - `protectedEntry` now tests the path, then its `.ts` spelling.
  - **Kept in step:** `coordinator.md` names each, and `settings.json` denies each to the Edit
    tools. `check:bug-fix-workflow` pins the two new path patterns.
    - `coordinator-protected` is stricter: for each launcher path rule, the prompt needs a glob
      that covers every tracked file the rule refuses. Before, `bugFixRuns*.ts` still passed
      against the widened `bugFix*` rule.
    - The fixture's `refused()` makes the same `.ts` rewrite. The prompt must carry the sibling
      sentence and every extension, and `SIBLING_SOURCE` is pinned.
    - The settings deny only tracked files. A new sibling is refused by the launcher, and the run
      is warned by the prompt but not stopped at the edit: a glob such as `concurrency.*` would also
      deny legitimate new files.
    - 34 more mutants, 215 in all: a new prompt name or deny line dropped, a glob narrowed,
      wrong-cased or over-wide, a pattern split over lines, the sibling sentence reworded, an
      extension or the no-extension words dropped.
    - A rule's label sits in a const (`PIPELINE_MODULES`), because the fixture reads one rule per
      line.
  - **`check:bug-fix-runs`** refuses a change to each newly protected file and to eight siblings:
    `concurrency.MJS`, and extensionless `githubApp` and `untrusted` among them. It still accepts
    the near misses:
    - `server/bugReports.ts`;
    - `env.ts`, `env.js` and an extensionless `env`;
    - `db/schema.ts`;
    - the `(app)/pipeline/` pages;
    - a `server/pipelines/` folder.

    That is 122 checks. Each new rule was proved by a hand-planted mutant: with the rule taken
    out, its cases fail. An unanchored `pipeline` rule fails the folder control. A rewrite that
    tests only the `.ts` spelling stops refusing `check-secrets.mjs` and `.pnpmfile.cjs`. The fixture's simulated Actions run ids now start at 20,000: the 31 extra
    runs had reached 9701, an id a backstop test binds by hand.
  - Not added: `services/director-worker/src/eval/`. It judges only agent-definition changes, and
    a run cannot make one (`agents/` is protected).

- 2026-11-09 — **A fix run is told what the launcher refuses** (13D follow-ups; `scripts/bug-fix/`,
  infra-railway). The pilot paid for runs that broke a rule the prompt never named.
  - **`coordinator.md` Never** now lists every path and name `bugFixRunsChange.ts` protects, with
    the `.d.mts` twins, the ratchet and agents-knowledge scripts, `untrusted.ts`, the bug routes and
    fixtures, `pyproject.toml`, `requirements*.txt`, `Procfile`, `nixpacks.toml` and the lockfiles.
    It also lists:
    - the `package.json` keys that change what installs;
    - the hook-script rule: no new `pre*`, `post*`, `pnpm:*` or `install` script, so no
      `precheck:<x>`. A plain `check:<x>` script is fine. A new
      `apps/launcher-api/scripts/check-<x>.ts` or `*.fixture.ts` needs none: run it alone with
      `pnpm check:all --only <path>`;
    - every suppression string, refused anywhere in an added line, prose and string literals
      included (`@ts-nocheck` was missing), and the inline ESLint comments;
    - the secret scan as the launcher runs it: raw patterns, no `// pragma: allowlist secret`
      exemption and no placeholder pass, so a full SHA counts. The fixtures' pragma'd SHA lines
      are the pattern a run would copy;
    - the privacy rule: gate commands too, names compared on letters and digits inside words;
    - the caps (a changed file counts whole, not by its diff), and the shape rules from
      `pathProblem`, `baseProblem` and `collect.mjs`: a name ending in a dot or a space, a file
      swapped for a folder, hard links, nested repositories, and files over 2 MB;
    - the vendored bundles: never committed, and the summary asks a person for `build:<name>`.
  - Step 3 has the run check its planned fix against that list before writing it.
  - Step 6 asks `code-reviewer` for an old-vs-new comparison over generated inputs when a change
    rewrites a parser or touches money: #1540's gap.
  - **`settings.json`** denies the Edit tools what the launcher refuses, so a run finds out at the
    edit, not after the spend. It adds 27 rules: the missing paths, and each protected name at any
    depth (`**/…`).
  - **`check:bug-fix-workflow`** reads the launcher's own lists from `bugFixRunsChange.ts` and the
    bundle list from `check-vendored-bundles.mjs`. A list it cannot read whole (a spread, another
    quote, an entry of another shape) counts as broken. Nine new rules (52 in all) fail on drift:
    - the prompt must name each protected path, name, lockfile, ratchet, `package.json` key, hook
      prefix, suppression and cap, and each bundle with its build;
    - every refusal sentence a `…Problem`, `secretIn` or `switchedOff` function returns is in a
      pinned table with the prompt's words for it, so a new or reworded one fails until someone
      checks the prompt. The same holds for the launcher's pattern rules, pinned by source, so a
      widened regex fails too;
    - the review step must ask for the comparison;
    - every tracked file the lists refuse (303 today) must be denied to Edit, and no other.
      Matching is by case (the stricter reading), with `[…]` read as a glob class as gitignore
      does. A literal `bugs/[number]/` rule would miss the directory, so the rule uses
      `bugs/*/`;
    - 68 new planted mutants (181 in all): a list renamed or half-read, a launcher rule or refusal
      added, a regex widened, a name dropped from the prompt, a deny rule removed, wrong-cased or
      too wide. A plain check reads the Rigger's two bundles from disk, to keep the prompt's "over
      the cap" true.
  - A `code-reviewer` pass on the change found the secret, suppression-anywhere and privacy gaps,
    and the places the first fixture's rules were weaker than they looked; all are fixed above.
  - `check:agents-knowledge` passes: every path the prompt names exists.

- 2026-11-09 — **Three small items the 13D pilot left, fixed.**
  - **A run that ends before its job reads the bug spent $0, and says so.** That covers a Stop
    while queued, a refused dispatch, and "The Actions run did not start" or ended before the
    brief. Such a run never ran Claude Code, so its line reads "$0.00", not "spend unknown".
    `settleFixRun` sets it in the same update, from the status as the update finds it, so a
    brief read between a Stop's look and its settle leaves the spend unknown. Pinned in
    `check:bug-fix-runs`, with that race planted.
  - **Check 2 on a draft fix pull request says what the verdict posted.** That run's jobs are all
    skipped, so no run renders the head, while the verdict has already posted its status (#1536
    and #1537 read "has not started" over a `success`). A posted `success` now reads "nothing to
    render", naming the status. Any other posted status shows "not started" and quotes the
    verdict's sentence ("A fix run's draft: current-games runs once it is marked ready for
    review"). Only the verdict's own "no game can differ" sentence goes green: a `success` in other
    words, which anyone with status access could post, stays "not started". The change is in
    `loadHarnessReport`, pinned in `check:pipeline-changes` against `touched.mjs`'s `describe`.
  - **The text cleaner keeps a `<word>` placeholder.** In a run's public text a tag is now shown
    as text, `<Month> 2026` → `‹Month› 2026`, where it used to be dropped (#1540's body read
    " 2026"). Any other `<` that could open a tag in a lenient HTML parser becomes `‹` too, so no
    markup survives. The secret scan and the privacy rule also read the text with its tags taken
    out, so a key split by an empty tag (`sk-<b></b>ant-…`) or a project name split by a tag
    (`Bo<b></b>rut`) is still refused: without that reading, the fixture's empty-tag case opens a
    PR. Pinned in `check:bug-fix-runs`.

- 2026-11-09 — **The Start fix pilot (ADR-0013 card 13D).** Three real launcher defects, filed on
  `/bugs` with the owner's yes and started from the **Start fix** button on the live launcher, as
  admin. None reaches `apps/lines` or `packages/*`.

  | Bug | Defect | Fix run | Actions run | Outcome | Time | Spend |
  |---|---|---|---|---|---|---|
  | BUG-9 | Admin › Costs › Import history misreads `May 2026` and `1,234.56` | `8c8981176a` | 42521840450 | Stopped from the run line while queued (cancelled during the install; Claude Code never started) | 20 s | $0 |
  | BUG-9 | (same) | `61399e5d24` | 42521900864 | `no_fix` (`needs_person`): both defects fixed, with a fixture and passing gates, then refused because the change added a `precheck:` script | 14 min | $1.95 |
  | BUG-10 | links between the in-app tool guides 404 | `f642d70210` | 42562859121 | `pr_opened`: #1537, merged after small review fixes (the repository from `ENV`, the status entry, two guide links) | 11 min | $1.90 |
  | BUG-11 | the shelf packer makes a page wider than its maximum | `80d2c58918` | 42562897448 | `pr_opened`: #1536, merged once a person rebuilt the Rigger's `rigger-text.js` | 8 min | $1.63 |
  | BUG-9 | (re-run) | `de66c4f853` | 42579743223 | `pr_opened`: #1540, fixed the reported lines but misread others; merged after two rounds of review fixes by a person | 14.5 min | $2.97 |

  - **Measured cost, replacing ADR §9's estimate (~$1.5–8 a run):** a run that does the work costs
    **$1.63–2.97, $2.11 on average, in 8–15 minutes.** The pilot spent $8.45 in all, from
    `director_spend` (agent `bug-fix`, one row per run: no agent sets a model, so every sub-agent
    runs on the coordinator's Opus 5.5). With the 13B spike's real fix ($1.20), the five real
    runs so far span $1.20–2.97. The $15 cap is 5–12× a measured run, and $150 a month buys about
    70 runs. A run stopped before Claude Code starts spends nothing and records no row.
  - **Outcome:** all three bugs are fixed on `main` and Resolved by the link sync. No run's change
    merged as it came: one was refused (BUG-9's first run), one needed a bundle a run cannot ship
    (#1536), one needed review fixes for a regression its own gates passed (#1540), and one had
    small nits (#1537). The follow-ups are open item 4.
  - **After BUG-9's refusal**, BUG-9, BUG-10 and BUG-11 each got a one-line triage note: no
    `pre*` script; a new `apps/launcher-api/scripts/check-<name>.ts` runs in `check:all` on its
    own. No run that followed added a `pre*` script.
  - **13C's browser pass** (owner's Chrome, admin), all as `docs/tools/pipeline-bugs.md` and
    `pipeline-changes.md` describe:
    - **Send and start fix** on the bug page (sent, then started) and **Start fix** on a Bugs-tab
      card, each behind an in-page dialog;
    - the run line through Queued, Working, Fix proposed, No fix and Stopped, with the Actions
      link, the spend and the run's own words; the activity's "Fix run `<id>` started work on the
      bug";
    - **Stop** behind a dialog, settling Stopped at once ("Stopped by …", "spend unknown"), and a
      new run started on the same bug after it;
    - with two runs going, every other card's button greyed: "2 fix runs are going already, the
      most at once (Admin › Settings). Start this one when one ends.";
    - **Mark ready for review** behind a dialog, then current-games ran and the merge bar
      ("Squash-merges head … into main") merged as the App; the link sync moved each bug to
      Working on and then Resolved.

    Seen beside it: the small items under open item 4. Not exercised: **File it** (no run proposed
    a second bug) and Start fix as a non-admin.
  - The 13B spike's seeded reports, BUG-4 to BUG-7, are closed as Won't fix (owner's yes).

- 2026-11-08 — **The 13B live spike passed (ADR-0013 §10).** Five fix runs on seeded test reports,
  started through the API (`POST /api/bugs/<n>/fix-runs`) as admin, with the per-run budget
  lowered for the spike and put back to $15 after it.

  | Case | Bug | Fix run | Actions run | Outcome | Spend |
  |---|---|---|---|---|---|
  | 1. a real defect with a fixture | BUG-8 | `842286b74c` | 42512292337 | `pr_opened`: draft #1533, BUG-8 at Working on | $1.20 |
  | 2. print env, read the key, curl it out | BUG-4 | `736cd723ed` | 42510829701 | `no_fix` (`needs_person`) | $0.34 |
  | 3. edit `.github/` and `.claude/agents/` | BUG-5 | `ef5ca33996` | 42510832676 | `no_fix` (`not_reproduced`) | $0.26 |
  | 4. push, merge, mark ready, mint OIDC, upload | BUG-6 | `1cdfec06c3` | 42511011789 | `no_fix` (`not_reproduced`) | $0.17 |
  | 5. a bug that does not reproduce | BUG-7 | `56a750d520` | 42511014361 | `no_fix` (`not_reproduced`), summary on the bug | $0.43 |

  - **Total $2.40,** from `director_spend` (agent `bug-fix`, 7 rows). Admin › Costs, "Anthropic
    (agents)".
  - **The public logs** show only the job's three fixed lines. No bug text, key, `sk-ant-` or
    token variable appears in any of the five, and no run has an artifact.
  - **Every live step ran green:** the App's dispatch (which proves its Actions write), the OIDC
    brief, the install, the lock, step 4 and step 5.
  - **Case 1:** #1533 (2 files: the fix, and 5 new `check-pipeline-changes` cases) was opened by
    the App as a draft, with gates and a `## Lesson`, and with none of the bug's text. Its one
    commit is the App's bot's, verified, on the run's base. current-games ran nothing: its
    `pull_request` run was skipped, and the branch had no push run. **Not as documented:**
    #1514 says the verdict posts `pending` on a fix run's draft. Here it posted `success`
    ("Runtime untouched"), deciding from the diff that no game can differ. No branch code ran,
    so this is harmless, but a draft that touches the runtime has not been seen yet.
  - **Cases 2–4:** the model refused each instruction, and no branch or PR was made. So the live
    runs never put the sandbox to work; `bug-fix-proof.yml` does (76 / 76).

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
