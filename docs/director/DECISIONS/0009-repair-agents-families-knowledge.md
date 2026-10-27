# ADR-0009 — Repair agents, game-family specialists and a shared knowledge base

- **Status:** approved with changes (2026-10-27, owner; see "Owner decision" at the end). 9A built
  the same day.
- **Date:** 2026-10-27
- **Scope:** (1) agents that fix the pipeline, (2) agents that fix a game, (3) agents specific to a
  game family, (4) one committed knowledge base that build agents and runtime agents both read, so
  a session or a run stops re-learning what earlier sessions already learned.
- **Builds on:** ADR-0001 (agent runtime), ADR-0002 (tool adapters), ADR-0004 (current-games
  harness), ADR-0007 (pipeline-change mechanics). Touches the Bug Reports tools
  (`docs/status/bug-reports.md`) and the game families (`docs/design/game-families.md`).

## Context

An audit on 2026-10-27 checked whether Director, its runtime agents, the Claude Code build agents
and the newer platform tools still fit together. The findings that drive this ADR are listed here.
The plain drift it also found is fixed in the same change (see "Fixed with this ADR").

### Two layers of agents, never named as such

- **Build agents** (`.claude/agents/*.md`, 26 of them) run in Claude Code sessions. They change
  code, which goes through a PR and so through Pipeline Changes (ADR-0007).
- **Runtime agents** (`services/director-worker/agents/*.md`, 8 of them) run inside the
  director-worker. They change one project's content through the adapters (ADR-0002) and can never
  change code, publish, or touch math.

A repair belongs on one of these layers depending on what is broken. Today neither layer repairs
anything.

### Nothing fixes anything

- **Pipeline bugs:** Pipeline Bug Reports (`/bugs`) has triagers **send** a bug to Pipeline
  Changes. The Bugs tab (`listSentBugs`, `apps/launcher-api/src/lib/server/bugReports.ts:326`) lists
  sent pipeline bugs only, with **Copy fix brief** (`bugBrief`, `src/lib/bugReports.ts`). A person
  pastes the brief into a session. No build agent mentions `/bugs`, `BUG-<n>` or the brief.
- **Game bugs:** Game Bug Reports (`/game-bugs`) are never sent to Pipeline Changes. Their brief
  limits the fix to the project's own content. No agent takes them. A game bug whose cause turns out
  to be in the engine cannot be moved to the pipeline list (bug-reports open item 2).
- **Director:** `run.request_pipeline_change` only writes an activity line
  (`services/director-worker/src/workerTools.ts:332`). No bug, branch or PR comes of it.
- **QA cannot run.** `qa.md` needs `build.request_draft` and `build.play_draft`. No ops module serves
  them (`apps/launcher-api/src/lib/server/director/registry.ts`), so `run.assign_task` always
  refuses QA (`workerTools.ts:402`). Every run reaches hand-off without a draft play.
- **Playtester:** `game-playtester` is the only agent with a detect → fix → verify loop. It is
  written for slots. Its Agent-SDK fix-worker (Playtester Phase 3) is designed but not built.

### Game families have outgrown the agents

The kinds in `packages/constants-shared/gameKinds.ts` are lines, ways, cluster, scatter, holdAndWin
(plus bookOf, which is retired into a Lines preset) and the non-slot families match3 and arcade.
Card games are planned next. Since 2026-10-25, match-3 and free-play arcade games can be published,
so they can be marked as Director templates.

- **Build agents:** only `book-of-game` is specific to a game type. Hold and Win, coin board, pots,
  bonus games, match-3, arcade (with Characters and Salmons) and card games have no specialist.
  Their status rows say "per phase".
- **Runtime agents:** every prompt is written for slots: QA's "base spin, Hold and Win trigger, big
  win", the coordinator's batch order, the mockup screen tags, "reel strips" in every Never list.
  The locked items (`director/templates.ts`) are slot items. An arcade template would reach the
  animator and builder and only then fail with 403 `not_for_family` (`gate.ts`). It would not be
  refused at the start.
- **Adapters missing for a reskin:** Sound (high), FX (high), the Component Editor (medium-high:
  `scene.update_nodes` cannot reach art inside a component), Shader Graph (medium), Characters
  (arcade only).

### Knowledge lives in the wrong places

- **Status files are long.** The committed record is about 35,000 lines of `docs/status/*.md`, plus
  the frozen `docs/history.md` (7,600 lines) and `docs/director/HISTORY.md`. A session told to "read
  the status file" for Hold and Win reads 2,650 lines to learn a handful of rules.
- **Lessons sit in personal memory.** About 38 `[[…]]` links in nine build agents
  (`[[gotcha_…]]`, `[[feedback_…]]`, `[[reference_…]]`) point at the owner's personal Claude
  memory. That memory is not in the repo, so cloud sessions, teammates and runtime agents never see
  it.
- **The same classes of bug come back.** In the two weeks to 2026-10-27 there were more than 100
  sessions. Several fixed the same family of bug again: rig origin and placement drawn off in the
  Scene Editor (at least 5 sessions), and the editor not matching the game (at least 4). The fixes
  are in the status files. The dead ends each session went through are only in the session
  transcripts.
- **Runtime agents learn almost nothing.** Their only cross-run memory is the template default
  recipes (`director_template_recipes`). A system prompt is exactly the definition body, one cached
  block (`services/director-worker/src/model.ts`). No shared knowledge is injected.

## Decision (proposed)

### 1. Name the two layers and route repairs by them

| What is broken | Layer | Who fixes it | How it lands |
|---|---|---|---|
| A tool, the engine, a template, the launcher | build | a Claude Code session using the owning tool agent | a PR → Pipeline Changes checks → owner merge |
| One project's content (art, layout, text, symbol states, rigs) | runtime | a Director **repair run** | adapter writes with `baseEtag`, owner checkpoint, never a publish |
| A runtime-agent definition or the knowledge it reads | build | `director-backend` (+ Agents tab eval) | a pipeline change, as ground rule 2 requires |

### 2. Pipeline repair (build layer)

- **New build agent `pipeline-triage`.** It takes a pipeline bug (its number, or the fix brief). It
  reproduces the bug, maps the bug's area to the owning tool agent, and hands it over with the
  evidence. The fix branch must be named `bug-<n>-<slug>` so the existing link sync moves the bug to
  Working on, then Resolved. It never fixes outside the area it routed to. A cross-area cause gets
  a second bug.
- **The fix brief names the agent.** `bugBrief()` gets one line: "Start with the `pipeline-triage`
  agent; name the branch `bug-<n>-…`". This is a small launcher change.
- **Director files a real bug.** `run.request_pipeline_change` creates a pipeline bug report (kind
  `pipeline`, reporter "Director run <id>", the run and project linked, status Open, not sent)
  instead of an activity line. A triager still decides whether to send it. This reuses the Bugs tab
  and needs no new screen.
- **Later (optional):** a **Start fix session** button on the Bugs tab that opens a Claude Code
  session with the brief. It waits until the copy-brief path has been used for a while.

### 3. Game repair (runtime layer)

- **A repair run kind in Director.** The input is one game bug. It runs on the bug's project, not on
  a duplicate of a template. It goes through the same run state machine, budget cap, checkpoints and
  refusals (no publish, no Game Config, no math, no `published/**`).
- **New runtime agent `game-doctor`.** It reads the bug and its screenshots, reads the project's
  docs through the read ops, reproduces the bug with QA's draft play, fixes it with the existing
  write ops, and plays the draft again. The owner approves the result at a **Repair review**
  checkpoint.
- **Escalation.** When the cause is in the engine or a tool, `game-doctor` files a pipeline bug
  linked to the game bug, marks the game bug "Waiting on pipeline", and stops. This also closes
  bug-reports open item 2: a game bug becomes movable to the pipeline list, with a link.
- **Prerequisite: QA must be able to run.** Serve `build.request_draft` and `build.play_draft`
  (a draft runtime build of the project, played with forced books, using the current-games
  harness's determinism hook and screen scripts). Without this, neither a creation run nor a repair
  run can check its own work.

### 4. Game-family specialists

> Superseded by "Owner decision" item 2 below: one build agent per game type (built in 9B, #1404).

**Build layer: one agent per family, not one per kind.** Each owns its family's design and status
docs, its playbooks in `docs/playtest/`, its screen script in `scripts/current-games/screens/`,
and its knowledge file (§5).

| Agent | Covers | Replaces / joins |
|---|---|---|
| `slot-games` | lines, ways, cluster, scatter, the Book of Thermopylae preset, free spins | absorbs `book-of-game` |
| `hold-and-win-games` | Hold and Win (Classic, Collector, 3 Pots), coin board, pots overlay, bonus games | new |
| `match3-games` | match-3, rules-decided and RGS-decided, the board module | new |
| `arcade-games` | arcade, Characters, world and camera, Salmons, later multiplayer | new |
| `card-games` | when the family is designed | later |

All of them build on `engine-pixi-svelte`. `game-playtester` loads the family agent's knowledge
file before it plays a game of that family.

**Runtime layer: family packs, not more agents.** Eight roles times five families would be forty
prompts to keep in step. Instead:

- **A family pack per family** in `services/director-worker/families/<family>.md`. It holds the
  family's locked items, mockup screen tags, region batch order, QA books and screens, and its
  "never" list. The worker appends it to every agent's system prompt as a **second cached block**,
  chosen by the template's family. The definition body stays family-neutral, and the cache stays
  byte-stable within a run.
- **Refuse at the start.** A run whose template family has no pack is refused at create
  (`no_family_pack`), not partway through with 403s.
- **Adapters, ranked by what a reskin needs:** Sound, FX, Component Editor art, Shader Graph tints,
  then Characters (only with the arcade pack).

### 5. The knowledge base: `docs/knowledge/`

One committed place, written to be **cheap to load**. Every file has a line budget enforced by a
gate.

| File | Holds | Budget | Read by |
|---|---|---|---|
| `targets.md` | What we are building and for whom, the owner's standing decisions, the non-negotiables, and what "done" means | ≤ 120 lines | every build agent; every runtime agent (cached) |
| `families/<family>.md` | The family's invariants, where its code lives, its known failure modes, how to test it | ≤ 200 lines | the family agent, `game-playtester`; the runtime family pack is generated from its "runtime" section |
| `lessons/<area>.md` | Entries of **symptom → cause → fix → guard → PR**, at most 8 lines each, deduplicated by symptom | ≤ 300 lines; older entries roll into the guard they produced | the owning tool agent, `pipeline-triage`, `game-doctor` (by area) |

- **Read order changes.** An agent's "Read first" puts its knowledge file **before** the status
  file. The status file stays the full record (rule 6) and is read only for the part in hand.
- **Personal memory is folded in.** The ~38 `[[…]]` links are replaced by links to lessons entries.
  The owner exports those notes once (they are on the owner's machine, not in the repo).
- **Backfill (one-time).** A workflow distils lessons from (a) the committed docs ("Recent changes"
  in status files, `docs/history.md`, Director HISTORY, resolved bug reports) and (b) the session
  transcripts. The transcripts are the only record of the dead ends. Proposed scope: fix sessions
  from the last 30 days first, about 60–80 sessions, run in batches by area, with each batch's
  output reviewed as a PR.
- **Ongoing.** A PR that fixes a bug carries a `## Lesson` block in its description, like the
  `## HISTORY entry` block today. `docs-keeper` (build) or `historian` (Director) folds it into
  `lessons/` after merge. No lesson, no fold: the knowledge base only grows from fixes that
  actually merged.
- **Runtime knowledge is a pipeline change.** `targets.md` and the family packs reach runtime
  prompts. Changing them goes through Pipeline Changes with the Agents tab evaluation (ADR-0007,
  PLAN 5.4).
- **Gate `check:agents-knowledge`** (in `check:all`):
  - Every path a build agent names exists.
  - No build agent has a `[[…]]` link.
  - Every `TOOLS` entry and every game kind has an owning agent.
  - Every knowledge file is within its budget.
  - Every runtime agent's tools are actually served (this would have caught QA).

## Phasing (proposed Phase 9, each card its own branch)

| Card | What | Owner | Depends on |
|---|---|---|---|
| 9A | `check:agents-knowledge` gate; `docs/knowledge/` skeleton + `targets.md` | regression-guardian + docs-keeper | — |
| 9B | Family build agents (`slot-games` absorbing `book-of-game`, `hold-and-win-games`, `match3-games`, `arcade-games`) + their `families/*.md` | coordinator (each family's status as source) | 9A |
| 9C | Pipeline repair: `pipeline-triage` agent, `bugBrief` names it, `run.request_pipeline_change` files a bug | launcher-studio + director-backend | 9A |
| 9D | `build.request_draft` / `build.play_draft` ops so QA runs | director-backend + regression-guardian | — |
| 9E | Knowledge backfill workflow (docs, then transcripts in batches) + owner's memory export | coordinator + docs-keeper | 9A, owner opt-in |
| 9F | Runtime family packs + `no_family_pack` refusal + slot pack extracted from today's prompts (no behaviour change for slots, proven by the eval) | director-backend | 9B |
| 9G | Repair run kind + `game-doctor` + Repair review checkpoint + game → pipeline escalation | director-backend + director-frontend | 9C, 9D, 9F |
| 9H | Sound and FX adapters, then Component Editor art | director-backend | 9F |

Phase 6 (the pilot) does not wait for this. 9D does make the pilot's hand-off include a draft play.

## Consequences

- Repairs follow the same safety rules as creation. A game repair never changes code. A pipeline
  repair never skips Pipeline Changes. Neither publishes.
- Five family agents replace "per phase" and `book-of-game`. Each one is a file to keep current;
  the gate catches broken paths, not stale facts.
- The second cached system block adds one cache write per run per agent. Inside a run it is a
  cache read (0.1×).
- The transcript backfill is the one costly step. It is a workflow run on owner opt-in, and its
  output is reviewed like code.
- A knowledge entry can be wrong. Entries carry their PR, and the gate keeps them short enough to
  review.

## Fixed with this ADR (no decision needed)

- Build agents: `director-backend` (runtime-agent path, count), `invisible-game-maker` (publish
  script path), `book-of-game` (retired `bookOf` kind → Lines + Book of Thermopylae preset),
  `invisible-rigger` (ship chain is built), `invisible-fx` ("new" register and page),
  `game-playtester` (`.claude/launch.json` is local; non-slot playbooks), `launcher-studio` (owns
  Bug Reports).
- Status headers for game-maker, localization, ftp-browser and bug-reports name their agent.
- Director README: phase status and the runtime-agent count.

**Left for a pipeline change** (runtime definitions, ground rule 2):
- `coordinator.md`'s Never list says it may request a pipeline change "through the coordinator",
  and its Checkpoints section talks about "the coordinator" in the third person.
- `mockup-analyst.md`'s tool list is never used as tools.

**Left for the coordinator:**
- HISTORY has no entry for #1118.
- PLAN has no follow-up for P10.5 or for match-3/arcade publishing.

## Needs owner approval

1. **Game repair lives in Director (runtime layer, owner checkpoint, run budget).** Default: yes.
   The alternative is a Claude Code session per game bug: faster to build, but it can touch code.
2. **Family split:** four agents now (slot, Hold and Win, match-3, arcade), card games later, and
   `book-of-game` folded into `slot-games`. Default: yes.
3. **Transcript backfill scope:** fix sessions from the last 30 days first, in batches by area,
   each reviewed as a PR. Default: yes. Cost is estimated before it runs.
4. **Export your personal Claude memory notes** (the `[[…]]` ones) so they can be folded into
   `docs/knowledge/lessons/`. Default: yes.
5. **Start fix session button** on the Bugs tab: later, after the copy-brief path has been used.
   Default: later.
6. **Order:** 9A → 9D and 9C in parallel → 9B → 9E → 9F → 9G → 9H. Default: as listed.

## Owner decision (2026-10-27)

1. **Game repair runs inside Director**, on the Anthropic API (the run's budget and spend ledger), as
   proposed in §3.
2. **More family agents than proposed:** one per game type now that there are more of them. §4's
   build-layer table is replaced by:

   | Agent | Covers |
   |---|---|
   | `lines-games` | lines, the Book of Thermopylae preset (absorbs `book-of-game`), free spins |
   | `ways-games` | ways |
   | `cluster-games` | cluster and its cascade |
   | `scatter-games` | scatter |
   | `hold-and-win-games` | Hold and Win (Classic, Collector, 3 Pots) and the coin board |
   | `bonus-games` | the add-ons on any slot: the pots overlay and bonus games |
   | `match3-games` | match-3, rules-decided and RGS-decided |
   | `arcade-games` | arcade, Characters, world and camera, Salmons, later multiplayer |
   | `card-games` | when the family is designed |

   `docs/knowledge/owners.json` names each as the owner of its kind once 9B lands. The runtime
   family packs stay per family (slot, match-3, arcade), with the slot pack carrying a section per
   kind.
3. **Backfill: the last 30 days of fix sessions, plus background.** Besides lessons, the backfill
   writes what the pipeline is for (`docs/knowledge/targets.md`, started in 9A) and **one brief
   per live game** (`docs/knowledge/games/<project>.md`: client, what the game must be, kind and
   add-ons, playbook). Its cost is estimated before it runs.
4. **The personal memory notes are rebuilt by Claude, not exported.** They are not in the repo or a
   cloud container. 9E rebuilds each `[[…]]` note from its name, the sentence that cites it and
   the session transcripts. The links leave the agents as their entries land, and
   `check:agents-knowledge` keeps the count from growing.
5. **Order:** not chosen; it stays as listed in "Needs owner approval" item 6, with 9A first.

