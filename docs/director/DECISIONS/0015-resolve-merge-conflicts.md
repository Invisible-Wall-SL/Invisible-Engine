# ADR-0015 — Resolve a merge conflict from Pipeline Changes

- **Status:** approved (2026-11-26, owner; see "Owner decision" at the end)
- **Date:** 2026-11-26
- **Scope:** what a person can do in Pipeline Changes about a change marked **Blocked · Merge
  conflict with main**. Two actions: **Update from main** when GitHub can merge cleanly, and
  **Resolve conflict** when it can't. A run resolves the mechanical files itself and proposes the
  rest. Nothing reaches the branch until a person accepts. Also covers changes held on purpose.
- **Owner's request (2026-11-26):** "I get the conflict with main a lot, and there is no way to fix
  it from the pipeline, I guess we should be able to fix this too." And, from ADR-0014: "I can't
  have the pipeline decide without asking me first!" Choosing a side in a conflict is a decision.
- **Builds on:** ADR-0007 (the App, the merge gate, rollback), ADR-0013 (the fix-run workflow, its
  sandbox, OIDC, the launcher's re-check, protected paths), ADR-0014 (ask first, plain-language
  sections), ADR-0004 (a change that edits the harness needs the owner's hand merge).
- **Migrations:** one, on the next free number (`0050` today; the last on `main` is
  `drizzle/0049_fix_run_explanation.sql`).

## Context

### What exists on `main` (d0be5e3df)

- **How the conflict is decided.** The list reads each PR with `GET /pulls/{n}`
  (`apps/launcher-api/src/lib/server/pipelineChanges.ts:678`). `deriveStatus` turns
  `mergeable_state === 'dirty'` into Blocked, "Merge conflict with main" (`:452`). The detail says
  "Merge conflict with main: bring main in and resolve it." (`BLOCKED_CONFLICT_TEXT`,
  `routes/(app)/pipeline/view.ts:32`), but nothing on the page does that. `mergeChange` refuses
  `!mergeable` (`pipelineMerge.ts:322`).
- **The `main` ruleset** has `strict_required_status_checks_policy: false`. A branch does not have
  to be up to date to merge. Only a conflict blocks it.
- **The App** writes through the Git Data API, with no clone. `revertCommit`
  (`pipelineMerge.ts:662`) builds a commit from three trees, and refuses any file both sides
  changed. The App has **no `workflows` permission** (ADR-0013 §4, layer 5).
- **Fix runs** are the pattern to reuse (`.github/workflows/bug-fix.yml`, `scripts/bug-fix/`). The
  App dispatches them on `main`, and the `bug-fix` environment holds the key. Claude Code runs in a
  sandbox, from a pristine copy of `main`'s scripts, and posts its result with OIDC. The launcher
  re-checks the change (`bugFixRunsChange.ts`, protected paths at `:349`).
- **The fix-run gate.** A fix run's change is found by its branch name and `pr_number`
  (`fixRunOfChange`, `pipelineChanges.ts:727`). `requireDecision` (`pipelineMerge.ts:265`) then
  reads the bug's decisions.
- **Harness files** are `HARNESS_SOURCES`: `.github/workflows/` and `scripts/current-games/`
  (`pipelineChanges.ts:70`). A change that edits one "needs a manual merge after review".

### What the conflicts are (measured 2026-11-26)

**Method:** 377 PRs merged into `main` between 2026-11-04 and 2026-11-26. Of these, 140 (37%)
merged `main` in at least once, in 298 merge commits. Each merge was replayed with
`git merge-tree --write-tree` (diff3) to list the files git could not merge. This misses conflicts
fixed in a session that never pushed the merge, and branches that were rebased.

- **219 of the 298 merges hit a conflict, in 112 PRs**: 30% of all merged PRs.
- **Which files conflicted** (a file counts once per merge; 633 in all):

| Kind | Conflicts | Hunks where both sides only added lines |
|---|---|---|
| `docs/status/*.md` | 149 | 115 |
| Other docs (lessons, families, tool guides, design, playtest) | 82 | 37 |
| `scripts/runtime-bytes/*.json` | 154 | — (re-recorded, never hand-merged) |
| Vendored launcher bundles (`static/rigger/vendor/*.js`) | 15 | — |
| `pnpm-lock.yaml` · a ratchet baseline · a workflow | 4 · 1 · 1 | — |
| Migrations, `_journal.json` | 0 (12 migrations landed in the window) | — |
| Code | 227 | 67 |

- **Per merge:** 113 of 219 (52%) needed no judgement at all. 28 (13%) needed one only in docs,
  and 78 (36%) needed one in code.
- **How big the code conflicts are:** a median of 2 files and 24 conflicting lines; at the 90th
  percentile, 7 files and 207 lines; the largest, 19 files. About 15 of the 633 file conflicts were
  edits to a protected path (ADR-0013's list).
- **Workflow changes:** 37 of the 219 merges (17%) also brought in a change `main` made under
  `.github/workflows/`. 19 of `main`'s 378 commits in the window touched a workflow.
- **Today's cards:**
  - **#1929** (`claude/bold-cannon-3a8unw`) is 7 commits behind, and 3 files conflict. In
    `docs/status/salmons.md` both sides only added lines. `apps/lines/src/game/online.ts` and
    `packages/game-config/src/levelsShape.ts` have one small hunk each, against #1924 and #1926.
  - **#1140** is 727 commits behind, and 45 files conflict, two of them in `scripts/current-games/`.

### What this means

1. **Half the conflicts are mechanical.** Deterministic code can clear them, with no model or spend.
2. **GitHub won't do it, and the launcher can't.** `update-branch` refuses a conflict, and the
   launcher has no git. So the work runs in an Actions job, as fix runs do.
3. **Nothing in a conflict is private.** Both sides are public code. What needs guarding is the key
   and the right to push.
4. **Workflow changes may be refused.** GitHub refuses an App without `workflows` any push that
   creates or updates a workflow file. Its docs don't say whether that includes a merge that only
   brings in `main`'s own workflow change. If it does, about 1 resolution in 6 is affected. 15A
   tests it first.
   - **15A's answer (2026-11-27, #1940):** `update-branch` as the App was **accepted** with
     `main`'s change to `.github/workflows/bug-fix.yml` in the merge (merge commit `bee763a`). So
     Update from main is unaffected. A merge commit the launcher builds through the Git Data API
     and pushes with a ref update (15C's Accept) is still untested: 15C proves it on its first
     workflow-bringing resolution, and falls back to item 10 if GitHub refuses.

## Decision

### 1. Two actions, both on the change's detail

- **Update from main.** Offered on a Blocked change that GitHub says merges cleanly
  (`mergeable: true`) and that is behind `main` (`GET /compare/main...<head>`, in the detail only).
  The launcher calls `PUT /pulls/{n}/update-branch` as the App, with `expected_head_sha`, and
  GitHub makes the merge commit. There is nothing to choose, so it is one click with no proposal.
  - If the head moved (422), the page says "The branch moved; reload".
  - If GitHub refuses the App over a workflow file, the page says why and links to GitHub's own
    **Update branch**, which acts as the person.
- **Resolve conflict.** Offered when `mergeable_state = 'dirty'`. It starts a merge run (§2–§4),
  which ends in a proposal. **Accept** pushes it (§5).
- `BLOCKED_CONFLICT_TEXT` becomes "Merge conflict with main.", with the button beside it.
- **Who:** `pipelineMerge` (default admin) for Update, Resolve and Accept. Deciding what lands on a
  change is part of merging it.

### 2. Where it runs: `merge-main.yml`, two jobs

The App dispatches the workflow on `main` with four inputs: the run id, the PR number, the head SHA
and `main`'s SHA. All four are public, so there is no brief endpoint. The run is named
`Merge main <id>`, and the launcher binds it by that name, as it does fix runs.

- **Job `merge` holds no secrets and runs no branch code** (`contents: read`, no `id-token`). It
  merges `main` into the head at the two pinned SHAs. It applies the mechanical rules (§3) and the
  refusals (§4) from `main`'s copy of `scripts/merge-main/`. For every path both sides changed, it
  records git's clean merge or the file with its markers, as the artifact `merge`. It never runs
  `pnpm install`, a build or a ratchet: it runs in `main`'s context, and branch code that built
  there could poison the shared Actions cache that `main`'s other workflows restore, some of which
  hold secrets. The launcher takes from the record only what §5 allows, and CI proves the rest.
- **Job `propose` always runs, and only it posts.** It uses the `bug-fix` environment and the same
  key. Its sandbox steps are copied from `bug-fix.yml`, and a fixture proves them identical step for
  step, so `prove-cli.mjs`'s proof covers it too. Before the model starts, only `main`'s scripts
  run, and dependencies install with install scripts off, so no branch code runs outside the
  sandbox. The model step runs only when real conflicts remain and the budget allows. `collect`
  (from the pristine copy) checks the result and POSTs it with OIDC: audience
  `invisible-launcher-merge-main`, `job_workflow_ref` = `merge-main.yml@refs/heads/main`,
  `environment` = `bug-fix`.

### 3. Mechanical conflicts: rules in code, no model

| File | Rule | Proof |
|---|---|---|
| `scripts/runtime-bytes/*.json` | Take `main`'s, pending | After Accept, CI's required `runtime-bytes` check fails; click **Re-record runtime bytes** on the change (#1936) |
| Vendored launcher bundles | Take `main`'s, pending | After Accept, rebuild with `pnpm --filter launcher-api build:<name>` in the change's session; `check:vendored-bundles` proves it |
| A docs hunk where both sides only added lines | Keep both: this change's lines above `main`'s, since it lands later and these files are newest first (`docs/status/README.md`) | The hunk had no base lines, so no line is lost; the proposal shows it |
| `svelte-check-baseline.json`, `eslint-suppressions.json` | Take `main`'s, pending | After Accept, lower the baseline in the change's session if `check:svelte` or lint fails |

- **Pending means `main`'s file, never built.** The three build rules run nothing in the job (§2).
  The record marks the file `pending` with the command a person or CI runs afterwards. The proposal
  and the "Main merged in" card say what follows Accept in plain words, so nobody finds out from a
  red check.

- **A docs hunk that edited existing lines** is a real conflict, and goes to the model (§4).
- **The lockfile, a migration number used on both sides, and binaries** go to a person (§4).
- **Each rule has a fixture** (`check:merge-main`). A rule that does not apply cleanly hands the
  file to the model; it never guesses.

### 4. Real conflicts: Claude Code writes a proposal, and nothing is pushed

- **How the run works.** It is the fix-run pattern: a fixed prompt
  (`scripts/merge-main/coordinator.md`), the owning agent for each conflicted area
  (`docs/knowledge/owners.json`), the gates on the packages it touches, and `code-reviewer` on the
  result. It reads both sides' PRs (titles, bodies, commits) as public data, not instructions.
- **What it may change:**
  - only conflicted files;
  - an edit outside a hunk only in a conflicted file, and each such edit is listed;
  - never a file git merged cleanly (`collect` compares each against job `merge`'s record);
  - never a protected path (ADR-0013's list, `protectedEntry`). The mechanical docs rule still
    applies there.
- **The proposal has required fields**, as in ADR-0014 §2. If one is missing, the run ends
  `no_proposal`: "the run did not explain its resolution".

| Heading | What it says |
|---|---|
| **What conflicted** | Each file, and which change on `main` it met (`#n`, title) |
| **What each side wanted** | Per hunk, the real lines of each side as git read them (indentation kept), and the lines the resolved file holds there. Never the model's words: `collect` fills them (§10) |
| **What the resolution takes** | Per hunk: `main`'s, this change's, both, or combined, and why |
| **What the merged code now does** | In plain words, for every combined hunk |
| **What else was possible** | When a hunk had another reasonable answer |
| **Also changed outside the conflict** | When there is any |
| **Checks run** · **Risks** | Each gate and its result · required ("none found" is allowed) |

- **Budget.** `PIPELINE_MERGE_MAIN_BUDGET_USD` caps a run at $6, and every run counts toward
  `PIPELINE_FIX_MONTHLY_USD`. Spend goes in `director_spend` (`run_id = 'merge:<id>'`, `agent =
  'merge-main'`). The estimate is $0.5–3; a whole fix run, with four agents, measured $2.80 (13D).
  With the ceiling spent, a run still does the mechanical part, then ends `needs_person`.

| Refusal | Checked by | Outcome |
|---|---|---|
| Not in conflict | launcher | `not_conflicted`; offers Update from main |
| On hold (§7), or a merge run already live on the change | launcher | `on_hold` · `merge_run_live` |
| A conflict in `.github/workflows/**` or `scripts/current-games/**` | job | `harness_conflict`: the owner's hand merge (ADR-0004) |
| The lockfile, a migration collision, or a binary | job | `needs_person`, naming the file |
| A protected path the model would have to resolve | job | `protected_conflict` |
| More than 10 files, or 600 conflicting lines, left for the model | job | `too_large` (#1140 ends here) |

### 5. Accept: what lands, and on whose branch

- **The proposal card** shows the §4 sections, each hunk as `main` | this change | result,
  "resolved against main at `<sha>`, N commits behind now", and the cost, with **Accept** and
  **Discard**. A mechanical-only proposal uses the same, shorter card, and still needs Accept.
- **On Accept** (`pipelineMerge`), the launcher re-reads the PR. If the head is no longer the run's
  head, the proposal is `stale` ("the branch moved; resolve again"). If `main`'s commits since the
  run's SHA touch a conflicted file (compare API), it is `stale` too. Otherwise it pushes, and
  anything newer on `main` gets its own Update or Resolve.
- **The launcher builds the merge itself**, from three trees as `revertCommit` does: the merge
  base, the head, and `main` at the run's SHA. A path only one side changed takes that side's
  entry, as git would. Only paths both sides changed take the run's content (a build rule's
  file is one of them, with `main`'s entry), so a run cannot change anything else. The commit's parents are `[head, main SHA]`; its
  message lists each file's choice, then "Accepted by `<person>` in Pipeline Changes (merge run
  `<id>`)", with no CI-skip token. `PATCH /git/refs/heads/<branch>` with `force: false` moves the
  branch: a fast-forward or nothing.
- **Never a rebase, a force-push, or a push to `main`.** The merge commit is an ordinary commit on
  the branch. After the squash merge, the change rolls back from History as today (ADR-0007).
- **If GitHub refuses the App over a workflow file,** the run ends `needs_person` with the reason.
  **Copy merge brief** gives a session the branch, the files and the accepted choices.
- **A person's branch** (`claude/…`, `agents/…`): a merge commit is normal there. A session
  still working on it must pull before its next push. The card warns when the branch was pushed in
  the last hour.
- **A fix-run branch** (`bug-<n>-fix-<id>`): ADR-0014's gate is unaffected. `fixRunOfChange`
  matches the branch name and `pr_number`, and `requireDecision` reads the bug's decisions; a merge
  commit changes none of them. "What you're approving" stays the run's card, the resolution card
  sits under it, and the bug's decision is not re-opened.

### 6. Gates after resolving

- **CI runs again, and it is the gate.** A push by the App fires `synchronize`, so Lint, Checks,
  svelte-check, runtime-bytes and current-games run on the new head (current-games still skips a
  draft fix PR, #1514). The run's own gates are only evidence for the proposal.
- **Approvals reset, as today.** A screen approval's id embeds the head SHA (ADR-0007). A posted
  `current-games` success stays on the old head.
- **Mark ready and Merge are unchanged:** the head is pinned, the required checks apply, and so does
  the fix decision.
- **A "Main merged in" card** joins the change's detail. It shows who accepted and when, against
  which `main`, each file's choice, and which of the change's own files now differ from `main` in a
  new way because of the resolution.

### 7. Changes held on purpose (#1140)

Three options: a **Close** button for long-blocked drafts, an **On hold** mark, or nothing.
**Recommended: On hold.** #1140 is wanted, so Close is wrong for it. Doing nothing leaves it
looking broken.

- **Put on hold** (`pipelineMerge`) adds the label `on-hold` and an App comment with the person's
  note, so GitHub stays the record. The list shows "On hold · since `<date>`" in grey, not
  Blocked, and sorts it last. It offers no Update, Resolve or Merge until **Resume** removes the
  label.
- A draft blocked by a conflict for 14 days shows "N commits behind main for M days", with **Put
  on hold**. Closing a change stays on GitHub.

### 8. Data

```
merge_main_runs(
  id text PK, pr_number integer, branch text, head_sha text, main_sha text,
  status text CHECK in ('dispatched','running','proposed','accepted','discarded',
                        'stale','needs_person','no_proposal','failed','cancelled'),
  reason, files jsonb, explanation jsonb, merge_sha, spend_usd, gh_run_id,
  started_by_id, started_by, accepted_by_id, accepted_by, request_id unique, timestamps
)
partial unique index on (pr_number) where status in ('dispatched','running','proposed')
```

- **A run that dies** is settled by the fix runs' once-a-minute backstop (`backstopFixRuns`,
  `bugReports.ts:1422`). There is no new loop.
- **Protected paths:** `bugFixRunsChange.ts` adds `scripts/merge-main/`, so a fix run cannot change
  the resolver. The existing `pipeline*.ts` rule already covers the new server module.

### 9. Phasing

| Card | What | Agent | Proof |
|---|---|---|---|
| 15A | Update from main; On hold and Resume. **The workflows spike:** on a scratch branch, with a workflow change on `main`, try `update-branch` and a Git Data merge commit, each as the App | director-backend + director-frontend | `check:pipeline-changes`; the spike's answer recorded in the PR |
| 15B1 | `scripts/merge-main/`: the merge, the mechanical rules and collect, runnable on a local checkout | infra-railway + regression-guardian | `check:merge-main`, a fixture per rule. A replay of the window's mechanical merges must equal what the person committed, or each difference is explained |
| 15B2 | `.github/workflows/merge-main.yml`, kept thin: both jobs call 15B1's scripts, and the sandbox steps are copied. Also `coordinator.md` and `docs/INFRA.md` | infra-railway | `check:merge-main-workflow`: the sandbox steps match `bug-fix.yml`'s. **The owner merges it by hand**, because current-games refuses a change that edits a workflow |
| 15C | The migration; start and its refusals; dispatch; the result endpoint; validation and the three-tree build; the proposal, Accept, Discard and "Main merged in" cards; spend; the backstop; `docs/tools/pipeline-changes.md` and status | director-backend + director-frontend + docs-keeper | `check:pipeline-changes`, `check:merge-main-runs`, `check:migration-order`. Hidden until 15B2 is on `main` |
| 15D | Pilot on #1929, if it still conflicts, and two more | regression-guardian | The owner accepts or discards each, and says whether the card was clear |

**Order:** 15A first. Then 15B1 and 15C in parallel. 15B2 is the only card that waits on the
owner's hands, and it holds only the YAML.

### 10. The contract between the job and the launcher (fixed before 15B1 and 15C start)

15B1 writes the job's side, and 15C writes the launcher's. Each pins this section in its fixtures,
and the last of the two to land adds a cross-check that feeds 15B1's `collect` output to 15C's
parser.

**Dispatch** (the App, on `main`): `merge-main.yml` with the inputs `merge_run` (10 lower-case hex),
`pr` (digits), `head_sha` and `main_sha` (40 lower-case hex), and `budget_usd` (a decimal, at most
two places, from 0 to the run cap). The launcher sets `budget_usd` to the smaller of
`PIPELINE_MERGE_MAIN_BUDGET_USD` and what is left of `PIPELINE_FIX_MONTHLY_USD`, and to `0` when the
month is spent. The job passes it to the CLI's budget flag, and with `0` it skips the model step: it
still does the mechanical part, and any real conflict ends `needs_person`. The run is named
`Merge main <merge_run>`. The launcher stores the run's `base_sha` from the result, and Accept
treats a merge base other than the stored one as `stale`. (Amended 2026-11-27, from 15C's review:
without the input the job could not know the cap, and without `base_sha` Accept could not tell
that the run's hunks were cut against another base.)

**The result**, posted once by job `propose`'s `collect` to
`POST /api/pipeline/merge-runs/<merge_run>/result` with a GitHub OIDC token (audience
`invisible-launcher-merge-main`), as JSON:

```
{
  "mergeRun": "<id>", "headSha": "<40 hex>", "mainSha": "<40 hex>", "baseSha": "<40 hex>",
  "outcome": "proposed" | "needs_person" | "harness_conflict" | "protected_conflict"
           | "too_large" | "no_proposal",
  "failure": "<sentence>",            // instead of outcome, when the job itself broke
  "reason": "<sentence naming the file or files>",   // every outcome but proposed
  "files": [ { "path": "...", "choice": "main" | "change" | "both" | "combined",
               "rule": "runtime-bytes" | "vendored-bundle" | "docs-append" | "ratchet" | null,
               "content": "<text>" | null, "mode": "100644" | "100755" } ],
  "explanation": {
    "conflicted": [ { "path": "...", "met": [ { "pr": 1234 | null, "title": "..." } ] } ],
    "hunks": [ { "path": "...", "index": 0, "main": "<main's lines>", "change": "<this change's>",
                 "result": "<the resolved file's lines there>" | null,
                 "resultCut": 0,
                 "kind": "lines" | "description",
                 "takes": "main" | "change" | "both" | "combined", "why": "...",
                 "nowDoes": "..." | null, "otherwise": "..." | null } ],
    "outside": [ { "path": "...", "what": "..." } ],
    "checks": [ { "command": "...", "ok": true } ],
    "risks": "..."
  },
  "usage": [ /* as a fix run's result: per model, tokens and the CLI's cost */ ]
}
```

- **`files`** holds only the paths both sides changed. Content is UTF-8 text with no NUL (a binary
  is `needs_person`). `null` content means deleted. The launcher refuses any other path (§5).
- **The pending form.** A build rule's file (`runtime-bytes`, `vendored-bundle`, `ratchet`) has
  `rule` set, `choice` `main`, and `main`'s own content, with no regenerated content. The job never
  builds, so `regenerated` is not a choice any more. The launcher refuses a rule file that is any
  other choice, or not at the rule's own path. Its follow-up (above, §3) is not in the body: the
  launcher derives it from the rule and path.
- **`explanation`** is required when `outcome` is `proposed`, mechanical-only included. For a
  mechanical-only run, `collect` fills it from the rules: each hunk's `takes` and `why` come from
  the rule, and `checks` lists the text-only checks. A pending build rule adds what follows Accept
  to `risks`. `risks` is never empty: "none found" is allowed. Missing or empty fields end the run `no_proposal`.
- **Caps:** at most 10 files for the model plus the pending rule files; 2 MB a file and 4 MB in all;
  each text field 3,000 characters; 16,000 for `explanation` in all. Everything is untrusted text,
  cleaned and scanned like a fix run's summary (ADR-0013 §5).
- **A hunk's real lines are not prose** (amended after the 15C review). `main`, `change` and
  `result` are lines of code, and they are the job's, so they are not trusted either. `collect`
  fills them from git, never from the model's `result.json` (the model's own `main`/`change` are
  ignored): `main` and `change` from `merge-file`'s own segments, untrimmed (only the last line
  break is dropped), and `result` from the final file, as the text between the clean pieces git put
  around the hunk (hunk *i* lies between clean piece *i* and *i + 1*). Where a clean piece has two
  places (searched from the front and from the back: a lone `}` that a correct resolution also
  holds, which `merge-file` makes ordinary by merging eagerly) the hunks get no `result`. That is not
  an outside edit (only a piece that cannot be placed at all is), because the model could not know to
  list it; the card says the lines could not be located and to read the file. A `result` the job cut
  at its cap says how many lines it left out (`resultCut`), and the card says so before Accept pushes
  the whole file. `kind` is `lines` for a hunk of a content conflict and `description` for a
  rule's or a modify/delete hunk, whose `main` and `change` are words and whose result follows what
  it took; a `lines` hunk with a `null` result is shown as "could not be located", never as what the
  model says it took. They are outside the 3,000 and 16,000 caps and the prose scan, with their own
  caps (10,000 characters each, 120,000 over all hunks; over it, `no_proposal`). The launcher
  refuses a `result` that is not inside its file's content, scans the `result` lines neither side
  has for secrets, as sent, as cleaned and with format characters taken out (a key split by a
  zero-width character), and hides a side's own line that looks like a secret instead of refusing
  (the repository holds such lines). A format character (a zero-width joiner, a bidi mark) is shown
  as `⟨U+200D⟩`, never dropped, since the pushed file keeps it; a line the run added that holds one is
  refused, naming the file.
  They are shown as text only, to the proposal waiting for Accept, never as HTML and never in the
  other cards.
- **What Accept changes on this branch is a positional diff the launcher makes** (`explanation.diff`;
  amended after the 15C review, replacing a per-hunk list of "lines the run wrote"). The job sends
  no part of it. At the result the launcher reads the change's tree (at `headSha`) and `main`'s
  itself, fetches each file's head blob, and diffs that, by lines, against the run's stored
  `files[].content` (the bytes Accept pushes and the file route serves) with a small Myers O(ND)
  diff (`pipelineMergeRunsDiff.ts`), three lines of context, real numbers on both sides. A copy, a
  duplicate or a reorder is a `-`/`+` pair at its real position, and nothing depends on where a hunk
  was placed. A deleted file is all removed, a file the branch no longer has all added. A path both
  sides changed identically (Accept keeps main's entry) has no diff and no file to open; content that
  is main's own version of the file is shown as taking it whole. Past 2,000 changed lines or 80,000
  characters (or more changes than the diff looks for) the result is `no_proposal` ("The merge
  changes more than the card can show: resolve it by hand"), so nothing Accept pushes is unseen. The
  head blob is immutable under `headSha`, so the branch-tip check at Accept (a moved head is `stale`)
  is the check that the diff is still the one for the file Accept replaces. For every line the merge
  ADDS that neither side's version holds (membership, not a multiset): a lone CR, U+2028, U+2029,
  U+0085 or any format character is refused, naming the file (a CR at the very end is a CRLF), and a
  secret, as it is and with format characters removed, is refused; a secret-looking line a side does
  hold is hidden on the card. On the card every control character but tab, every format character,
  the line and paragraph separators, U+0085, U+FEFF and a no-break space is shown as what it is
  (`⟨CR⟩`, `⟨U+200D⟩`), never dropped; the raw text is capped first; nothing is stripped of a CI-skip
  token. Each file shows its diff under "What Accept changes on this branch" and an **Open resolved
  file** link: `GET …/merge-runs/<id>/file?path=…`, `pipelineMerge`, the exact text Accept would push
  from the run's own record (the branch is not fetched), `text/plain`, `nosniff`, `inline`, only for
  a path that has a diff and only while the run is `proposed` or `accepting`.
- **Accept's claim.** Accept takes `proposed → accepting` in the database, by the database's clock
  and with a 5-minute lease and a claim id, before any GitHub write; every later update, settle and
  release carries the claim id, and the merge commit's SHA is stored (with whoever built it) before
  the branch moves, which the claim must still hold with at least 90 seconds of its lease left (one
  slow GitHub call is about 60 seconds, so the claim cannot lapse while the push is in flight). A
  claim that already holds an earlier holder's commit is kept, not given back, by any failure that
  has not read the branch's tip: the backstop settles it from the tip. The page's "has the lease
  lapsed" is the server's, by the database's clock.
  Discard acts only from `proposed`, or on a lapsed claim that built no commit. A lost answer is
  recognised by the branch's tip being that commit or a descendant of it (a person may push on top),
  never by its parents or a token anyone can copy; the backstop settles a lapsed claim the same way
  (accepted if so, else the proposal is given back). A definitive refusal from GitHub (a 4xx other
  than 422) gives the claim back at once.
- **The result is posted up to three times** when the launcher answers 5xx (a GitHub read it makes
  failed, for example): the spend is recorded once per model and the settle is conditional, so a
  second post of a result that did arrive finds the run settled (409), not doubled.

## Consequences

- **About half the conflicts clear with one click and no spend.** The rest cost about $1–3 and a
  decision.
- **The App writes to branches other people own.** Until now it wrote only branches it made
  (reverts, agent edits, fix runs). It only fast-forwards, and a session must pull after an Accept.
- **One more workflow holds the Anthropic key:** the same key and environment, behind a sandbox
  proven identical.
- **Some changes still need a person's click on GitHub:** those where `main` brought a workflow
  change, if 15A confirms the refusal.
- **What it cannot do:** the lockfile, migration collisions, the harness, protected paths, and large
  stale branches. Each refusal names the file.
- **New surface:** one table, one setting, one label, one workflow, one endpoint, two fixtures, and
  three buttons (Update from main, Resolve conflict, Put on hold).

## Needs owner approval

1. **Update from main and Resolve conflict on Pipeline Changes.** Default: yes.
2. **Who:** `pipelineMerge` for Update, Resolve and Accept. Default: yes. The alternative is that
   `pipelineBugFix` may start a resolve, and `pipelineMerge` accepts.
3. **Every resolution waits for Accept, mechanical-only ones included.** Default: yes. The
   alternative is to push mechanical-only resolutions without asking.
4. **The mechanical rules in §3,** including that this change's docs lines go above `main`'s.
   Default: yes.
5. **A real conflict goes to Claude Code in `merge-main.yml`,** reusing the `bug-fix` environment
   and `ANTHROPIC_BUG_FIX_API_KEY`. Default: yes. The alternative is a key and environment of its
   own, which adds two setup steps.
6. **Budget:** $6 per run, counted in the $150 monthly fix ceiling. Default: yes.
7. **Refusals:** the harness, the lockfile, migration collisions, protected paths, and more than 10
   files or 600 lines. Default: yes.
8. **Accept is refused if the branch moved, or if `main` touched a conflicted file again.**
   Otherwise it pushes the resolution against the older `main`. Default: yes.
9. **The App may push a merge commit to any change's branch,** fast-forward only. Default: yes.
10. **If GitHub refuses the App over `main`'s workflow change,** the person uses GitHub's own
    Update branch, or **Copy merge brief** for a session. Default: yes. The alternative is a second
    App with Workflows write, used only after the launcher proves that every workflow file in the
    merge is `main`'s. Its key could write workflows on any branch, and a branch's workflow can read
    the repository's secrets.
11. **On hold instead of Close,** with the 14-day hint. Default: yes, and the owner puts #1140 on
    hold.
12. **Setup:** the owner creates the label `on-hold` once. Default: yes. The alternative is to give
    the App Issues write, so it can create the label itself.

## Owner decision (2026-11-26)

Approved: items 1–12 of "Needs owner approval", each at its default, as written. The open
questions take their suggested defaults. 15A starts. Item 12 is the owner's to do: create the
label `on-hold` once.

- **2026-11-27:** never build branch code in job `merge`. Runtime bytes, vendored bundles and the
  ratchets take `main`'s file, pending, and the proposal names what follows Accept (§2, §3, §10).

## Open questions

- **Migration collisions.** Build the renumbering when the first one happens: `db:generate` to the
  next number, proven by identical SQL and `check:migration-order`. There were none in the window.
  Suggested default: build it then.
- **A clean merge can leave a runtime-bytes manifest wrong:** the text merges, but the bytes are
  stale. Should Resolve also be offered when `runtime-bytes` fails on a change that is behind
  `main`? Suggested default: yes, as a mechanical-only run.
- **Should sessions stop merging `main` by hand once this ships?** Suggested default: no. Both
  paths end in a merge commit.
