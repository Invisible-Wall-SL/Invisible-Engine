# Invisible Director + Invisible Pipeline Changes

Two new online tools for the Studio launcher (app.invisiblewall.org):

- **Invisible Director** (`director`, CREATE section). It creates a game by re-theming a working
  template game. Runtime AI agents do the work across the existing tools (Atlas Maker, ComfyUI,
  Rigger, Flipbook, Symbols SM, Scene Editor, Win Text, Localization, Font Maker), and the run
  stops at checkpoints for the owner to review. Agents never publish, and they never touch the
  template's math.
- **Invisible Pipeline Changes** (`pipelineChanges`, new PIPELINE section). Every change to
  tools, engine, templates, blueprints or runtime-agent definitions lives on its own branch here.
  It merges only when the pipeline tests pass, every current game still builds and looks the
  same, and someone with `pipelineMerge` approves.

**Status:** Phase 0 is done and approved (2026-10-04). Phase 1 is in progress. Each task runs in its
own session, launched from a task card, and is coordinated from the coordinator session. See
"Task sessions" below.

## Documents

| File | What it is |
|---|---|
| [`KICKOFF_PROMPT.md`](KICKOFF_PROMPT.md) | The original brief, kept verbatim. Never edited. |
| [`SPEC.md`](SPEC.md) | What we build, grounded in the code. This is the living version of the brief. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the two tools plug into the platform: the platform map with file paths, and decisions as they land. |
| [`PLAN.md`](PLAN.md) | Phases, tasks, owner agent, status, acceptance criteria. |
| [`HISTORY.md`](HISTORY.md) | Append-only log, newest entry on top. |
| [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) | Questions for the owner, each with a suggested default. |
| [`DECISIONS/`](DECISIONS/) | One ADR per decision (index below). |
| [`mockups/`](mockups/) | The target screens: PNG to look at, HTML to inspect. |
| [`../../services/director-worker/agents/`](../../services/director-worker/agents/) | Drafts of the seven runtime agents. These are the definitions the Agents tab shows and edits. |

### ADR index

| ADR | Decision | Status |
|---|---|---|
| [0001](DECISIONS/0001-agent-runtime.md) | Agent runtime | approved |
| [0002](DECISIONS/0002-tool-adapters.md) | Tool adapters | approved |
| [0003](DECISIONS/0003-run-state-and-events.md) | Run state and events | approved |
| [0004](DECISIONS/0004-current-games-regression-harness.md) | Current-games regression harness | approved |
| [0005](DECISIONS/0005-mockup-analysis.md) | Mockup analysis | approved |
| [0006](DECISIONS/0006-costs-and-budgets.md) | Costs and budgets | approved |
| [0007](DECISIONS/0007-pipeline-change-mechanics.md) | Pipeline-change mechanics | approved |

### Mockups

| Screen | PNG | HTML |
|---|---|---|
| Launcher with the new tools | `01-launcher.png` | `01-launcher.html` |
| Director: New game | `02-director-new-game.png` | `02-director-new-game.html` |
| Director: Mockup breakdown | `03-director-mockup-breakdown.png` | `03-director-mockup-breakdown.html` |
| Director: Live run | `04-director-live-run.png` | `04-director-live-run.html` |
| Pipeline Changes | `05-pipeline-changes.png` | `05-pipeline-changes.html` |
| Admin › Roles | `06-admin-roles.png` | `06-admin-roles.html` |

## Build agents (Claude Code, `.claude/agents/`)

| Agent | Model | Owns |
|---|---|---|
| `director-architect` | opus | ADRs, ARCHITECTURE.md, design reviews |
| `platform-integrator` | sonnet | Registry, Launcher PIPELINE section, roles and `pipelineMerge`, Costs card, Settings budget |
| `director-backend` | sonnet | Agent runtime, run state, tool adapters, mockup pipeline, events, cost tracking |
| `director-frontend` | sonnet | Director and Pipeline Changes screens |
| `regression-guardian` | sonnet | Tests and the current-games harness. It never approves its own changes. |
| `historian` | haiku | HISTORY, PLAN status, ADR index, OPEN_QUESTIONS |

The coordinator (the main Claude Code session) assigns tasks and reviews results against the
acceptance criteria. It asks the owner before any merge.

## Task sessions

Each PLAN task (or a small group of tasks that share a branch) runs in its **own session**. The
owner starts it from a task card the coordinator issues. To keep parallel sessions from fighting
over the shared files:

- A task session works only on **its own branch**, named in the card, and opens a **draft PR** with
  a scoped title.
- A task session **does not edit `HISTORY.md` or `PLAN.md`**. It puts its HISTORY entry in the PR
  description under `## HISTORY entry`, using the usual format.
- The **coordinator session** reviews the PR against the acceptance criteria and asks the owner to
  merge. After the merge it copies the entry into `HISTORY.md` and moves `PLAN.md`.
- A new open question goes in the PR description under `## Open questions`, each with a suggested
  default. The coordinator adds it to `OPEN_QUESTIONS.md`.
- No session merges. Only the owner merges.

## How a session starts

1. Read this README.
2. Read [`PLAN.md`](PLAN.md) and find the task in `doing`, or the next one in `todo`.
3. Read the top of [`HISTORY.md`](HISTORY.md).
4. Read the ADRs the task cites. Build only on **approved** ADRs.

At the end of the session, add a HISTORY entry and update PLAN. The ground rules are in the root
`CLAUDE.md` § "Invisible Director + Invisible Pipeline Changes project" and in
[`SPEC.md`](SPEC.md) §3.
