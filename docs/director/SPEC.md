# SPEC — Invisible Director + Invisible Pipeline Changes

This is the living version of `KICKOFF_PROMPT.md` §1–2, rewritten against what the code actually does.
Where the brief and the code disagree, this file says so and points to `OPEN_QUESTIONS.md`. File paths
are in `ARCHITECTURE.md` §1. Last updated 2026-10-04 (Phase 0).

## 1. Invisible Director (`director`, online, CREATE section)

Director makes a new game by **re-theming a game that already works**. Runtime agents do the work
across the existing tools. The owner reviews at checkpoints, then publishes in Game Maker.

### 1.1 New game screen (mockup `02-director-new-game.png`)

- **Project.** Name, Key, Client and Game type.
  - These are the same fields, validation (`isValidProjectKey`) and options (`selectableGameKinds()`) as Game Maker's `create` action.
- **Template.** An existing published project of the chosen game type, e.g. Hold and Win 3 Pots Sample, hw-classic-sample, hw-collector-sample.
  - *Grounding:* these are ordinary projects, not a template kind (see Q1).
  - The template card shows the same GAME / USING chips Game Maker builds with `buildGameProfile`.
  - A **LOCKED** row lists what Director never changes:
    - the math contract (`config/config.json`: symbols and payouts, paytable, paylines, bet modes, win model, feature blocks such as `holdAndWin` / `potsOverlay`)
    - the reel strips
    - feature rules
- **Budget cap** for this run, pre-filled from Settings (ADR-0006, ADR-0008 §1). Not built yet:
  today a run takes the Settings cap when it starts, and the estimate is shown against it. There is
  no preset: the `atlas-technician` plans each region's recipe from the reviewed blueprint cards,
  starting from the template's approved default recipes, and the owner approves that plan at the
  **Art plan** checkpoint. The GPU is atlas-tool's, not a run setting.
- **Starting point.** Mockups, a style description, or both.
  - Upload one or more PNG/JPG images. Tag each one with a screen (Base game, Hold and Win bonus, Big win, Paytable…) or mark it **Style reference only**.
  - Fidelity: **Match the mockups closely** or **Use them as a starting point**.
  - A required checkbox: "These designs belong to us or to the client." The run cannot start without it, and the check is recorded with the user and time.
  - Notes / style text. Optional when mockups are uploaded, required when there are none.
- **Checkpoints.**
  - **Mockup breakdown** (a **style board** when there are no mockups). On by default.
  - **Art plan** (the recipes per region and their projected GPU cost). On by default.
  - **After each region batch.** On by default.
  - **Before publishing.** Always on and not editable. Agents never publish.
- **Summary panel:**
  - the agents and their models
  - region counts from the template, by group (Symbols, Coins & jackpots, Backgrounds, Reel frame & logo, UI kit, Win banners)
  - reused Spine rigs
  - an estimate: Claude API $, RunPod minutes and $, and the number of checkpoints
- **"Create project & start agents".**
  1. Creates the project exactly as Game Maker does: a `projects` row plus the R2 scaffold under `<client>/<project>/`. It copies the template with the duplicate path (`projectDuplicate.ts`, scope `full`).
  2. Starts the run.
  - *Brief vs code:* the brief says "on main". Game Maker never writes git, and a project is DB + R2 (see Q2).

### 1.2 Mockup breakdown screen (first checkpoint when mockups exist)

- Shows each uploaded image with numbered boxes around what the Mockup analyst found. Red boxes are clashes with locked items.
- A list of elements, each mapped to a template region, with a status:
  - **Matched**
  - **Needs you.** No region exists. The choices are "Skip it" or "Request a region". A request becomes a pipeline change on the template; it is never a silent workaround.
  - **Left out.** It clashes with a locked item, for example a Buy bonus button when the math has no buy feature. The UI names the locked item and says the math changes in Game Config, outside Director.
- The palette extracted from the mockups (named hex swatches).
- Regions no mockup covers. These are designed from the notes plus the palette.
- Font gaps, e.g. logo lettering with no match in Font Maker. The Builder will bake a close match for approval.
- Buttons:
  - "Looks right, start rendering"
  - "Send my changes" (free text to the coordinator)
- **Nothing is submitted to RunPod until the owner confirms.**

### 1.3 Live run screen (mockup `04-director-live-run.html`)

- **Header:**
  - name, key, status, client, game type, template
  - links "Open in Game Maker" and "Play draft". Play draft is the authoring Live link, never a publish.
  - spend so far (Claude API $, RunPod $), the GPU queue depth
  - Pause and Stop
- **Five steps:** Mockup breakdown (or Style board), Style pack, Regions (*n* of 39 approved), Build, Hand-off.
- **Amber waiting banner** whenever a checkpoint is open, with "Review *n* now".
- **Region groups.** One gallery per group with statuses approved / to review / drafting / queued, and filters.
- **Review panel:**
  - the mockup crop next to the variants
  - the art director's pick and reasoning
  - the owner's note
  - buttons "Approve *X*" and "Redo with my note"
  - Approval chooses that variant in the project's Atlas Maker manifest.
- **Activity feed.** Time, agent, what it did, and the tool used.
- **Message box.** The owner can talk to the coordinator mid-run, e.g. "do the background first". The coordinator replies with what changed in the plan.

### 1.4 Runtime agents

Definitions live in `services/director-worker/agents/*.md` (frontmatter plus a system prompt).

| Agent | Model id | Works in |
|---|---|---|
| Coordinator | `claude-opus-5-5` | Run plan, owner conversation, checkpoints, budget |
| Mockup analyst | `claude-opus-5-5` | Vision over mockups, region mapping, palette, conflicts |
| Art director | `claude-sonnet-5-5` | Reviews every variant, picks and explains |
| Atlas artist | `claude-sonnet-5-5` | Atlas Maker + ComfyUI on RunPod |
| Animator | `claude-sonnet-5-5` | Rigger, Flipbook, Symbols SM |
| Builder | `claude-sonnet-5-5` | Scene Editor, Win Text, Localization, Font Maker |
| QA | `claude-haiku-4-5-20251001` | Sizes, alpha, sheet budget, plays the draft |

**Hard refusals,** enforced in the adapter layer and not only in prompts:

- no publish
- no math-contract write
- no role or permission change
- no merge
- no agent-definition write

Agents reach the platform only through the adapters (ADR-0002).

## 2. Invisible Pipeline Changes (`pipelineChanges`, online, new PIPELINE section)

A separate tool. Director never links to it. Access comes from Admin › Roles.

- **Changes tab.** One entry per open pipeline branch, with a status: Testing (*n* of *m*), Ready to merge, or Blocked (with the reason).
  - **Detail:** title, what changed and why, files changed (+/−), and a link to the diff (the GitHub compare / PR).
  - **Check 1 — pipeline tests:** every CI gate, grouped (unit / fixtures, Atlas Maker, ComfyUI, engine, launcher gates, Python…). Shows pass counts.
  - **Check 2 — current games:** every game in Game Maker is rebuilt with the branch, its own tests run, and its key screens are compared with main. Any visible difference blocks the merge until the owner approves that difference.
  - **Merge into main:** needs `pipelineMerge`. Every merge is revertable from History.
  - "Discard branch" closes it.
- **Agents tab.** Shows and edits the runtime-agent definitions.
  - An edit creates a branch.
  - Its check is a short evaluation on a fixed sample (e.g. the mockup breakdown of a reference mockup set), shown before and after.
- **History tab.** Merges, who approved them, and rollbacks, each with a "Roll back" action.

## 3. Admin

- **Registry:** `director` and `pipelineChanges` (online). Director goes in the `create` stage. Pipeline Changes goes in a new `pipeline` stage (accent `#F778BA`, as in the mockup).
  - Both get "new" badges, `docs/tools/<slug>.md`, and icons in the four toolbar twins.
- **Capability:** `pipelineMerge` ("Merge pipeline changes").
- **Role defaults:**

  | Tool / capability | Admin | Pipeline Tester | Everyone else |
  |---|---|---|---|
  | `director` | on | off | off |
  | `pipelineChanges` | on | **granted** | off |
  | `pipelineMerge` | on | off | off |

  - Admin › Roles and per-user overrides work as they do for every other entry.
- **Costs:** a new provider card, "Anthropic (agents)", with a column in the monthly table.
  - Spend is recorded per run and per agent from each response's `usage`.
  - Prices per million tokens (input / output) come from config, not code:
    - Opus 5.5: $4 / $20
    - Sonnet 5.5: $2 / $10
    - Haiku 4.5: $1 / $5
  - Cache reads are billed at 0.1× input.
- **Settings:** a budget cap per Director run (default $25). At the cap the run pauses and asks the owner.

## 4. Ground rules

1. A game made by Director is created the way Game Maker creates one. No branch.
2. Everything else is a **pipeline change**: tools, engine, templates, blueprints, runtime-agent definitions, and this project's own code.
   - It goes on its own branch.
   - It merges only when all pipeline tests pass, every current game builds, passes its tests and looks the same, and the owner approves.
   - Merges are revertable.
3. Never break a current game. If a change can't be proven safe for every game, it doesn't merge.
4. Locked template items win. Conflicts are reported, not fixed.
5. Secrets stay on the server. `ANTHROPIC_API_KEY` is read only server-side (`env.ts`) and is never logged.
6. Mockups must be ours or the client's. The ownership check is kept and uploads go to the project's R2.
7. Follow existing patterns. No unrelated refactors.
8. Long GPU jobs are queued and resumed, never waited on in an agent polling loop.

## 5. Out of scope

- Changing math in Director. That happens in Game Config, by a human.
- Publishing from Director.
- New game types or mechanics. Those are pipeline changes to templates.
- Translating strings. The Builder writes source strings; the Localization flow stays human-reviewed.
