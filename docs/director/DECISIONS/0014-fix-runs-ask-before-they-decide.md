# ADR-0014 — Fix runs ask before they decide, and say what they did

- **Status:** proposed (2026-11-26), waiting on the owner
- **Date:** 2026-11-26
- **Scope:** how a fix run (ADR-0013) works. Each run first diagnoses the bug and offers options.
  The owner picks one, and only then does a second run build it. A fix change says in plain words
  what the owner is approving. Every run ends with an outcome a person can read, on the bug and on
  the change.
- **Owner's request (2026-11-26):** "I have run a bug fix through the pipeline, it now says it is
  ready for review, but I am not sure what was done cause no description was left. How can we make
  it more user friendly so I know what I am actually reviewing and approving? … it seems like the
  pipeline already came with a solution … I can't have the pipeline decide without asking me
  first!"
- **Builds on:** ADR-0013 (fix runs), ADR-0007 (Pipeline Changes, Mark ready, the merge gate), and
  the Profiler's P5 **File as bug** (`docs/status/profiler.md`).
- **Migrations:** one, on the next free number.

## Context

### What happened (2026-11-26)

- A Profiler capture on an old, low-memory phone found low frame rates. The owner filed it with
  **File as bug**, which made a pipeline bug. Its text is the Profiler's finding: the rule, the
  measurement, **the saving the rule expects**, the owner and the Compare links
  (`profilerFindings/bug.ts`).
- **Start fix** dispatched fix run `d2a4594cb1`
  ([Actions run 45771936785](https://github.com/Invisible-Wall-SL/Invisible-Engine/actions/runs/45771936785)).
  Claude Code ran for 56 s. The run ended **`no_fix`**, cost $0.46 and opened no pull request.
- The Actions job shows a green tick, because the *job* succeeded. The run's only public log line
  is "fix run d2a4594cb1: no_fix, $0.46" (one line on purpose: ADR-0013 §4 keeps the bug private).
  The run's reason is on the bug page, as one amber "No fix" line in the Triage card.
- The owner then opened `/pipeline?change=1140` and saw a draft change with **Mark ready for
  review**. That is #1140, the Book-of removal from October, which is unrelated to this bug.
  Nothing led the owner from the run to the right place, or told them there was no change at all.

### What the design does today

1. **A run decides alone.** `scripts/bug-fix/coordinator.md`: "Nobody answers questions during the
   run: decide, or end it with the outcome that says a person is needed." `needs_person` covers
   what a run *cannot* do (production data, R2, a dependency, a protected path). It does not cover
   a bug where reasonable people would pick different fixes. A performance bug on a weak device is
   that kind: lower quality, a lite mode, a minimum spec, or leave it alone.
2. **A Profiler-filed bug arrives with a fix in its text.** The finding's "saving" reads like a
   plan, and nothing tells the run it is only one option.
3. **The change says little in plain words.** The PR body is the run's `summary` (free text, at
   most 2,000 characters, "in the code's terms"), then the gates, the lesson and who started it
   (`publication()` in `bugFixRunsChange.ts`). Pipeline Changes shows a "Why" that `whyFromBody`
   takes from the first paragraph. Nothing says, in the owner's terms, what was reported, what was
   wrong, what changed, what else was possible, or how to check it.
4. **"No change" is easy to miss.** A `no_fix` run is one amber line. A green Actions tick and a
   "Mark ready for review" bar on *some* change both read as progress.

## Decision

### 1. Two kinds of run: Diagnose, then Build

**Start fix** becomes **Diagnose**. A diagnose run triages and reproduces the bug as today
(`pipeline-triage`, the owning agent read-only), but **it never changes a file**. It ends with a
diagnosis, posted on the bug:

- **What was reported**, restated in one or two plain sentences.
- **What is causing it**, with the evidence: the measurements, files and lines involved.
- **Kind:** `defect` (the code does something wrong, and there is one right fix) or `decision`
  (there are several reasonable answers, and choosing between them is a product call).
- **Options**, 1–4. Each one has a name, what it would change (in plain words), what it costs (the
  work involved and the risk to current games), and what the player would notice. "Don't fix:
  below the supported device floor" and "Needs a person" are valid options.
- **Recommendation:** which option, and why.

The bug then shows **Waiting on your decision**. A person with `pipelineBugFix` picks an option,
optionally adds a note, and clicks **Build "<option>"**. That starts a **build run** whose brief
pins the chosen option and the note. The build run may implement only that option. If it turns
out not to work, the run ends `needs_person` and explains why; it does not switch to another
option.

- **There is no auto-build**, not even for a `defect` with one option. That case is still one
  click, but it is always a person's click. (Owner item 2 can relax this later.)
- **A Profiler-filed bug:** the coordinator is told that the finding's saving is *one* option to
  weigh, not the plan. The diagnosis also weighs whether the device is below the supported floor.
  The diagnosis reads the cited readings and builds already in the brief. It never asks for a new
  capture when the brief already has one.
- **Budget:** a diagnose run is capped at $5 (a new Settings value, `PIPELINE_DIAGNOSE_BUDGET_USD`);
  a build run keeps the $15 cap. Both count toward the monthly ceiling.

### 2. The result says what was approved, in fixed sections

The run's `result.json` gains required fields. A build run's PR body is made of fixed headings,
filled by `publication()`:

| Heading | Source | Required |
|---|---|---|
| **What you reported** | the diagnosis's restatement | yes |
| **What was wrong** | the diagnosis's cause, in plain words | yes |
| **The option you chose** | the decision: option name, who chose it and when, their note | yes |
| **What changed** | the run's plain description, no code terms | yes |
| **What else was possible** | the options not chosen, one line each | yes, when there were others |
| **How to check it yourself** | steps a person can follow in a tool or game | yes |
| **Risks** | what it could affect | yes ("none found" is allowed) |
| Gates run · Lesson · Started by | as today | as today |

If a required field is missing or empty, the run ends `no_fix` with the reason "the run did not
explain its change". The launcher validates this the way it already validates scope and gates.

### 3. Pipeline Changes: a "What you're approving" card

A change whose branch is `bug-<n>-fix-<id>` shows a card at the top of its detail panel, above the
files. It shows the sections from §2, a link to the bug, and a link to the decision. For these
changes `whyFromBody` reads **What changed**.

**Mark ready for review** (and merge) on a fix-run change also needs the change's option to match
the decision recorded on the bug. The server checks this in `markReadyForReview`. A change built
for an option nobody chose cannot leave draft.

### 4. Outcomes a person can read

- **At the top of the bug page**, one plain banner per state:
  - "Diagnosing…"
  - "Waiting on your decision — 3 options"
  - "Building option B…"
  - "Fix proposed — review change #N", which links to that change and only that change
  - "**No change was made** — <reason>"

  The run's full summary shows under the banner, not folded away.
- **The Bugs tab card** shows the same banner.
- **The Actions log** stays one line (it is public), and gains the bug page's address. A person who
  starts from the green tick lands on the banner. The run's display name says what it was:
  "Fix run <id> · diagnose" or "Fix run <id> · build".

### 5. Data

- `bug_fix_runs` gains:
  - `mode` (`diagnose` | `build`);
  - `diagnosis` (jsonb, the §1 fields, length-capped like `summary`);
  - `option_id` (the build's chosen option);
  - `parent_run_id` (the diagnose run a build came from).
- The decision is a `bug_report_events` row, `fix_decision`: the person, the run, the option and
  the note. A new diagnose run makes earlier decisions stale.
- `result.json`'s schema and `collect.mjs` learn the new fields. `check:bug-fix-workflow` pins the
  prompt to the launcher's field list, as it already pins the refusal sentences.

### 6. Protected paths

This change edits files a fix run must never touch: `coordinator.md`, `bugFixRuns*.ts`,
`pipeline*.ts`, and `api/pipeline/`. It is a pipeline change made by a person, and the owner
merges it (ADR-0007).

### 7. Phasing

| Card | What | Agent | Proof |
|---|---|---|---|
| 14A | Diagnose mode: prompt, result schema, `diagnosis` column, the bug's options and **Build** button, the decision event, the banner | director-backend + launcher-studio | `check:bug-fix-runs`, `check:bug-fix-workflow`; the CLI proof with a scripted diagnosis |
| 14B | Build mode: pinned option, required sections, `publication()` headings, the Pipeline Changes card, the Mark-ready check against the decision | director-backend + director-frontend | `check:pipeline-changes`, `check:bug-fix-runs` |
| 14C | Pilot: re-run the slow-phone bug as a diagnose run (≈ $1–2) and decide on it; tool guides `pipeline-bugs.md`, `pipeline-changes.md`; status | regression-guardian + docs-keeper | The owner reads the diagnosis and the resulting change, and says whether it is clear |

## Consequences

- Every fix costs two runs and one decision. That is slower and costs slightly more, about
  $0.5–2 more than today, in exchange for no surprise solutions.
- Pipeline Changes can say exactly what is being approved, and refuses a fix nobody chose.
- A run's prose is longer, so the length caps rise: about 3,000 characters per section, with a
  total limit.
- Profiler findings become proposals to discuss, not instructions.

## Needs owner approval

1. **Diagnose first, always, with no code changed until a person picks an option.** Default: yes.
2. **No auto-build, even for a single-option defect.** Default: yes. The alternative is an opt-in
   Setting that auto-builds `defect` diagnoses with one option.
3. **Who decides:** `pipelineBugFix` (the same people who may start a run). Default: yes. The
   alternative is `pipelineMerge` only.
4. **Required plain-language sections, or the run ends `no_fix`.** Default: yes.
5. **Mark ready for review and merge check the change against the recorded decision.** Default: yes.
6. **Diagnose budget $5 per run.** Default: yes.
7. **A supported-device floor.** The diagnosis needs a written floor to weigh "below the floor"
   against: a minimum RAM, GPU tier, or a list of reference phones. Default: the owner states one
   in `docs/knowledge/targets.md`. Until then, the diagnosis offers "below floor" as an option for
   the owner to judge.

## Open questions

- How did the owner reach #1140 from this bug? The bug's linked changes and the Bugs tab should
  only lead to the bug's own change. If a link sent them there, that is a bug of its own.
