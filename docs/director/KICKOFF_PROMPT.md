# Kickoff: Invisible Director and Invisible Pipeline Changes

You are the **coordinator** for a new project in this repository: two new online tools for the Invisible Wall pipeline (app.invisiblewall.org). You plan the work, create the build agents, hand them tasks, review what they produce, and keep the project's markdown history up to date. You don't merge anything into main without my approval.

You already know this codebase. Everything below describes **what** to build and the **rules**. The **how** is yours: explore first, follow the patterns the platform already uses, and propose decisions in writing before building.

The mockups are in `docs/director/mockups/` (PNG to look at, HTML to inspect). They show six screens: the Launcher with the new tools, Director's New game, Mockup breakdown and Live run screens, Pipeline Changes, and Admin › Roles. Match the existing tool pages (tool header with the tool nav, cards, tags, buttons, admin tabs) and let the tool pages stretch to full screen width.

---

## 1. What we are building

### 1.1 Invisible Director (new online tool, key `director`)

A tool in the **CREATE** section of the Launcher, next to Game Maker and Game Config. It creates a game with AI agents that work across the existing tools while I review at checkpoints.

**New game screen**
- **Project:** Name, Key, Client, Game type. These are the same fields and options as Game Maker's "Create a game".
- **Template:** an existing game of that type to start from (for example Hold and Win 3 Pots Sample, hw-classic-sample, hw-collector-sample). Show its GAME and USING tags the way Game Maker does. The template's math contract (Game Config), paytable, bet modes and feature rules are **locked**. Agents re-theme a game that already works; they never change its math.
- **Preset:** the Atlas Maker blueprint, draft and final resolution, variants per region, and RunPod GPU the art agents use.
- **Starting point:** design mockups, a style description, or both.
  - Upload one or more images. Tag each one with the screen it shows (Base game, Hold and Win bonus, Big win, Paytable…) or mark it **Style reference only**.
  - Fidelity choice: **Match the mockups closely** or **Use them as a starting point**.
  - A required check: "These designs belong to us or to the client."
  - Notes and style text, optional when mockups are uploaded.
- **Checkpoints:** where the run stops and waits for me:
  - **Mockup breakdown** (a style board when there are no mockups). On by default.
  - **After each region batch.** On by default.
  - **Before publishing.** Always on. Agents never publish; I publish in Game Maker.
- **Summary panel:** the agents with their models, the regions from the template, and an estimate (Claude API cost, RunPod time and cost).
- **"Create project & start agents"** creates the project **on main under client/project, the same way Game Maker does**, then starts the run.

**Mockup breakdown screen** (first checkpoint when mockups exist)
- Each uploaded image with numbered boxes around what the Mockup analyst found.
- A list of those elements and the template region each one maps to, with a status:
  - **Matched**
  - **Needs you:** no region exists for it. Offer "skip" or "request a region", where requesting a region is a pipeline change.
  - **Left out:** it clashes with something locked, such as a Buy bonus button when the math has no buy feature.
- The palette extracted from the mockups.
- Regions not covered by any mockup, which will be designed from the notes and the palette.
- Font gaps (for example, logo lettering with no match in Font Maker).
- Buttons: "Looks right, start rendering" and "Send my changes" (free text to the coordinator agent).
- **Nothing renders on RunPod until I confirm.**

**Live run screen**
- **Header:** name, key, status, client, game type and template, links to Game Maker and to a playable draft. Spend so far (Claude API, RunPod), the GPU queue, Pause and Stop.
- **Five steps:** Mockup breakdown (or Style board), Style pack, Regions, Build, Hand-off.
- **Waiting banner:** an amber banner when a checkpoint is waiting.
- **Region groups and gallery:** one gallery per group (Symbols, Coins & jackpots, Backgrounds, Reel frame & logo, UI kit, Win banners) with statuses: approved, to review, drafting, queued.
- **Review panel:**
  - The crop from my mockup next to the variants, with the art director's pick and reasoning.
  - My note.
  - Buttons: "Approve" and "Redo with my note". Approved art goes into the project's Atlas Maker sheet.
- **Activity feed:** time, agent, what it did, and which tool it used.
- **Message box:** I can talk to the coordinator agent mid-run, for example "do the background first".

**Runtime agents** (they live inside the product, not in Claude Code):

| Agent | Model | Works in |
|---|---|---|
| Coordinator | `claude-opus-5-5` | Plans the run, talks to me, enforces checkpoints and budget |
| Mockup analyst | `claude-opus-5-5` | Reads the mockups, maps every element to a template region, extracts the palette, flags conflicts |
| Art director | `claude-sonnet-5-5` | Reviews every variant before I see it; picks and explains |
| Atlas artist | `claude-sonnet-5-5` | Atlas Maker, ComfyUI on RunPod |
| Animator | `claude-sonnet-5-5` | Rigger, Flipbook, Symbols State Machine |
| Builder | `claude-sonnet-5-5` | Scene Editor, Win Text, Localization, Font Maker |
| QA | `claude-haiku-4-5-20251001` | Sizes, alpha, sheet budget, plays the draft build |

Runtime agents may **never**:
- publish a game
- edit a math contract
- change permissions or roles
- merge anything
- edit their own definitions

They can only use the platform's own tools, through adapters you build.

### 1.2 Invisible Pipeline Changes (new online tool, key `pipelineChanges`)

A **separate** tool in a new **PIPELINE** section of the Launcher. Director doesn't link to it. Access is driven by Admin › Roles like every other tool.

- **Changes tab:** one entry per branch: testing, ready to merge, or blocked with the reason.
  - **Detail view:** what changed and why, the files changed, and a link to the diff.
  - **Check 1, pipeline tests:** all of them, grouped (unit, Atlas Maker, ComfyUI, engine, and so on).
  - **Check 2, current games:** every game in Game Maker is rebuilt with the branch, its own tests run, and its key screens are compared with main. Any visible difference blocks the merge until I approve it.
  - **Merge into main:** needs the new capability `pipelineMerge`. Every merge can be rolled back from History.
- **Agents tab:** view and edit the runtime agent definitions. An edit is a pipeline change, so it gets a branch. Its check is a short evaluation on a fixed sample (for example, the mockup breakdown of a reference mockup set), shown before and after.
- **History tab:** merges, who approved them, and rollbacks.

### 1.3 Admin

- **Tool registry:** `director` and `pipelineChanges` (online).
- **New admin capability:** `pipelineMerge` ("Merge pipeline changes").
- **Role defaults in Admin › Roles:**
  - **Director:** Admin on, everyone else off.
  - **Pipeline Changes:** Admin on, Pipeline Tester granted, everyone else off.
  - **Merge pipeline changes:** Admin only.
- **Costs:** a new provider card, "Anthropic (agents)", plus its column in the monthly table. Record spend per run and per agent.
  - Current list prices per million tokens, input / output: Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 4.5 $1 / $5. Cache reads are billed at 0.1× input.
  - Read these from config, don't hardcode them.
- **Settings:** a budget cap per Director run, default $25. When a run reaches it, it pauses and asks me.

---

## 2. Ground rules (always)

1. **Games made by Director go straight to main** under client/project, like Game Maker. No branch.
2. **Everything else is a pipeline change.** That covers tools, engine, templates, blueprints, runtime agent definitions, and this project's own code.
   - It goes on its own branch.
   - It merges only when **all pipeline tests pass**, **every current game still builds, passes its tests and looks the same**, and **I approve**.
   - Merges are made so they can be rolled back.
3. **Never break a current game.** If you can't prove a change is safe for every game, it doesn't merge.
4. **Locked template items win.** Mockups and style notes never change the math, the paytable, bet modes or feature rules. Conflicts are reported, not "fixed".
5. **Secrets stay on the server.** The Anthropic API key is a server environment variable. Never put it in client code, the repo or logs.
6. **Mockups must be ours or the client's.** Keep the ownership check, and store uploads in the project's cloud storage like other assets.
7. **Follow the existing patterns:** registry, roles, launcher cards, tool header and nav, styling, storage paths. Don't refactor unrelated code.
8. **Long GPU jobs are queued and resumed, never waited on in a polling loop** that burns tokens.

---

## 3. Phase 0: set up the project (do this now)

### 3.1 Explore (read only)

Find and note, with file paths:
- how a tool is registered (registry, Launcher section and card, tool header and nav)
- how roles and capabilities work, including per-user overrides
- Game Maker's project creation from a game type and template
- Atlas Maker regions, variants, blueprints, sheet packing and deploy
- the ComfyUI and RunPod job flow
- the data formats of Symbols State Machine, Scene Editor, Win Text, Localization and Font Maker
- how the platform already calls AI providers (keys, retries, cost tracking)
- how the Costs tab gets its providers
- how games are built, versioned, republished and played (Play and Live links, Storybook)
- existing tests and CI
- deployment (Railway services) and the storage layout in R2

### 3.2 Create the docs and the markdown history

Create `docs/director/` with:

- `README.md`: what this project is, the two tools, links to everything below, and how a session starts.
- `SPEC.md`: section 1 of this prompt, rewritten in your words and grounded in what you found in the code.
- `ARCHITECTURE.md`: how Director and Pipeline Changes plug into the platform. Fill it in as decisions are made.
- `PLAN.md`: phases, tasks, owner agent, status (`todo / doing / review / done`), and acceptance criteria for each task.
- `HISTORY.md`: an append-only log, newest entry at the top, one entry per task or session:

  ```
  ## YYYY-MM-DD · Phase 0 · coordinator
  - Did: …
  - Files: …
  - Branch / PR: …
  - Tests: …
  - Decisions: ADR-0001 (proposed)
  - Next: …
  ```

- `DECISIONS/`: one ADR per decision (`0001-agent-runtime.md`, …). Each has: context, options, recommendation, consequences, and a status of `proposed / approved / superseded`.
- `OPEN_QUESTIONS.md`: questions for me, each with your suggested default.
- `mockups/`: already provided. Don't change it.
- `KICKOFF_PROMPT.md`: this brief, already provided. Keep it as the original; `SPEC.md` is the version you keep up to date.

Add a short section to the root `CLAUDE.md` (create the file if it's missing; don't rewrite what's there). It should say that this project's docs live in `docs/director/`, give the ground rules from section 2, and give the session routine:
- **At start:** read README, then PLAN, then the top of HISTORY, then the relevant ADRs.
- **At end:** add a HISTORY entry and update PLAN.

### 3.3 Create the build agents (Claude Code subagents)

Create them in `.claude/agents/`, each with frontmatter (`name`, `description` saying when to use it, `tools`, `model`) and a body covering: its role, what it owns, what it must not touch, what to read first (README, PLAN, its ADRs), and how it reports back. A report says what changed, which tests ran, and what's left, and the agent adds a HISTORY entry.

| Agent | Model | Owns | Must not |
|---|---|---|---|
| `director-architect` | opus | ADRs, ARCHITECTURE.md, design reviews of the other agents' plans | write feature code without an approved ADR |
| `platform-integrator` | sonnet | registry entries, Launcher cards and PIPELINE section, roles and `pipelineMerge`, Costs card, Settings budget | change existing tools' behavior |
| `director-backend` | sonnet | agent runtime, run state and checkpoints, tool adapters, mockup storage and analysis pipeline, event stream, cost tracking | touch math contracts or publishing |
| `director-frontend` | sonnet | Director screens (New game, Mockup breakdown, Live run) and Pipeline Changes screens, matching the mockups | invent new visual styles; reuse the platform's components |
| `regression-guardian` | sonnet | all tests for new code, plus the current-games harness (rebuild, game tests, key-screen comparison); runs before every merge request | approve its own changes |
| `historian` | haiku | keeps HISTORY, PLAN status, the ADR index and OPEN_QUESTIONS tidy after each task | change code |

You, the coordinator, assign tasks, review results against acceptance criteria, keep branches small, and ask me for merges.

### 3.4 Draft the runtime agents

Write first drafts of the seven runtime agents from 1.1 as data files, in the place your runtime ADR recommends. Each draft gives: name, model id, role, the platform tools it may use, inputs and outputs, rules from section 2, and how it behaves at checkpoints. These drafts are what the Agents tab in Pipeline Changes will show and edit later.

### 3.5 Propose the first decisions (ADRs, status: proposed)

- **0001 Agent runtime.** Where the runtime agents run and on what. The default to evaluate is the Claude Agent SDK as a server-side worker next to the platform, using an API key. The alternative is Claude Managed Agents with the platform's tool adapters exposed as a remote MCP server. Recommend one.
- **0002 Tool adapters.** How agents call Game Maker, Atlas Maker, ComfyUI, Symbols State Machine, Scene Editor, Win Text, Localization and Font Maker. Cover auth, permissions per agent, idempotency, and queued GPU jobs that resume instead of polling.
- **0003 Run state and events.** The run record, steps, checkpoints, pause and stop, messages from me, the live event stream to the UI, and resuming after a restart.
- **0004 Current-games regression harness.** How every game in Game Maker is rebuilt with a branch, tested, and compared screen by screen against main: fixed seeds, tolerance, and approval for intended differences.
- **0005 Mockup analysis.** Storage, per-image tags, vision analysis, mapping to template regions, conflict handling with locked items, palette and font extraction, and fidelity modes.
- **0006 Costs and budgets.** Spend per run and per agent, the Costs card, the budget cap, and showing estimates before a run.

### 3.6 Write the plan

Write the plan in `PLAN.md`. Each phase gets its own branch or branches, and is done only when tests pass, the current-games check is green, there's a HISTORY entry, and I've approved it.

1. **Foundations:**
   - registry entries, roles and `pipelineMerge`, Launcher cards and the PIPELINE section, the Costs card, Settings budget, empty tool pages with the shared header
   - **the current-games regression harness first**, because every later merge depends on it
2. **Tool adapters:** each platform step callable by agents, with tests.
3. **Director runtime:** runtime agents from files, the run state machine, checkpoints, mockup analysis, the event stream, cost tracking and the budget cap.
4. **Director UI:** New game, Mockup breakdown and Live run, matching the mockups, full width.
5. **Pipeline Changes:** branches list, checks, merge with `pipelineMerge`, the Agents tab with evaluations, History and rollback.
6. **Pilot:** one real Hold and Win reskin from hw-3pots-sample, started from the art director's mockups, with me reviewing at each checkpoint. Fix what it reveals and document it.

---

## 4. Your first report, then stop

When Phase 0 is done, reply with:

- **What you found:** the key existing pieces, with file paths.
- **Files created:** docs, agents and runtime-agent drafts.
- **ADRs:** each recommendation in one line, with what you need me to approve.
- **Open questions:** at most 10, each with your suggested default.
- **Next step:** the first branch name and the first three Phase 1 tasks.

**Then stop and wait for my OK before writing any feature code.**
