# PLAN — Invisible Director + Invisible Pipeline Changes

**Status values:** `todo / doing / review / done`. `done` means the owner approved it.

**When a phase is done:**
- its branch(es) pass every pipeline test
- the current-games check is green, once it exists (task 1.6)
- there is a HISTORY entry
- the owner approved it

**How phases run:**
- Each phase works on its own small branches off `main`.
- A session that can only push to its own designated branch uses that branch instead of the card's name; the PR is what counts.
- PR titles use the existing scopes with a `director` detail (`launcher(director): …`, `pipeline(director): …`, `docs(director): …`), as `scripts/check-commit-scope.mjs` requires, and are squash-merged per repo convention.
- Nothing merges without the owner.

## Phase 0 — Set-up · `claude/upbeat-feynman-pwgx6a`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 0.1 | Explore the platform and record it with paths | coordinator | done | ARCHITECTURE §1 covers every item in brief §3.1 |
| 0.2 | `docs/director/` docs + root CLAUDE.md section | coordinator | done | README, SPEC, ARCHITECTURE, PLAN, HISTORY, OPEN_QUESTIONS and DECISIONS exist; CLAUDE.md section added without rewriting the rest |
| 0.3 | Six build agents in `.claude/agents/` | coordinator | done | Each has frontmatter (name, description, tools, model) and a body covering role, owns, must-not, read-first, and reporting |
| 0.4 | Seven runtime-agent drafts | coordinator | done | `services/director-worker/agents/*.md`, each with model id, role, tools, inputs/outputs, rules and checkpoint behaviour |
| 0.5 | ADR-0001…0006 (proposed) | coordinator | done | Each has context, options, recommendation, consequences and status |
| 0.6 | Owner review of Phase 0 | owner | done | ADRs approved or changed; open questions answered |

## Phase 1 — Foundations

Phase 1 is split into five task cards, each with its own branch. Cards A–D run in parallel. Card E
starts once A and B are merged.

| Card | Branch | Tasks | Depends on |
|---|---|---|---|
| A | merged #1035 | 1.1 | — |
| B | merged #1036 | 1.2 | — |
| C | merged #1037 (+ follow-up #1038) | 1.7–1.10 | — |
| D | merged #1040 | 1.11–1.12 | C (merged) |
| E | merged #1041; calibrated by 1F (#1061) | 1.3–1.6 | A, B |

The harness is calibrated (#1061): main vs main gives 0 changed screens on the live games, twice in a row, and a seeded 1 px change is caught. Follow-ups: #1057 (skip untouched changes), #1062 (CI retry), #1063 (renders as republished).
A change that cannot reach a game (docs only, or nothing in the `lines` runtime's workspace closure, the gates' inputs or the harness itself) passes `current-games` without a build or a render, so launcher, atlas-tool and director-worker cards are not held by it.

| # | Task | Card | Owner | Status | Acceptance |
|---|---|---|---|---|---|
| 1.1 | Game-list source for CI: `/api/pipeline/games` (CI-token gated, read-only) | A | platform-integrator | done | A `check:` fixture shows 401 without the token; the list equals `listGames()` |
| 1.2 | Determinism hook in the runtime: a test-only flag for clock, seed and GSAP stepping | B | regression-guardian (+ engine-pixi-svelte) | done | With the flag off, the bundle behaves the same and screenshots are unchanged; with it on, two runs give pixel-identical captures |
| 1.3 | Screen scripts per game type (`scripts/current-games/screens/<type>.json`) with forced books | E | regression-guardian | done | Every live game type covered; 12–14 screens each; reviewed by the owner |
| 1.4 | Harness runner: build both runtimes, serve snapshots, capture, pixelmatch with `tolerance.json`, report JSON/HTML | E | regression-guardian | done | main vs main → 0 differences on every game, twice in a row; per-screen noise measured and recorded |
| 1.5 | `current-games.yml` workflow + commit status + artifact | E | regression-guardian | done | The status can be made required; sharded; runs in under 15 min |
| 1.6 | Seeded proof: an intentional 1 px engine change is caught | E | regression-guardian | done | The harness reports exactly the changed screens, and the revert turns it green |
| 1.7 | `director` and `pipelineChanges` in `TOOLS`; new `pipeline` stage; "new" badge; icons in the 4 toolbar twins | C | platform-integrator | done | `check:toolbar-icons` passes; the launcher shows CREATE and PIPELINE as in mockup 01 |
| 1.8 | `pipelineMerge` capability and role defaults | C | platform-integrator | done | The Admin › Roles matrix matches mockup 06; a fixture covers defaults, role overrides and user overrides |
| 1.9 | Empty `/director` and `/pipeline` pages: full width, `ToolTopBar`, gated | C | platform-integrator | done | 403 for a role without the tool; no iframe |
| 1.10 | `docs/tools/director.md`, `docs/tools/pipeline-changes.md`, README rows, `TOOL_DOC_SLUG` | C | platform-integrator (docs-keeper) | done | `/docs/<slug>` renders (repo rule 9) |
| 1.11 | Costs: `anthropicAgents` provider, `director_spend` table + migration, card + monthly column; `pricing.json` | D | platform-integrator | done | The card renders with $0; prices come from the file; a fixture computes the cost of a sample `usage` with cache reads at 0.1× |
| 1.12 | Settings: `DIRECTOR_RUN_BUDGET_USD` (default 25) card + action | D | platform-integrator | done | Validated, clamped, and degrades on a DB error like `getRunpodIdleConfig` |

## Phase 2 — Tool adapters · branch `director/adapters`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 2.1 | Adapter gate: service token, run scope, per-agent allow-list, `director_ops` idempotency | director-backend | done | Fixtures: wrong token 401; out-of-scope project 403; disallowed op 403; replayed `opId` returns the same result |
| 2.2 | Hard refusals (publish, game-config, roles, merge, agent defs, `published/**`) | director-backend | done | One failing-on-purpose fixture per refusal |
| 2.3 | Game Maker adapters: get template, duplicate as project (Game Maker path) | director-backend | done | Creates the same `projects` row + R2 tree as the `create` action + `duplicate full` |
| 2.4 | Atlas Maker adapters: list/get region, set prompt, queue variants (returns a jobRef), list variants, choose variant, pack/compose | director-backend (+ atlas-python-tools) | done | Works against a test project; writes go through CAS; no model-side polling |
| 2.5 | atlas-tool pipeline change: render completion callback + resumable still queue | atlas-python-tools | done | Restart during a render → the job resumes or re-queues once; Python tests pass |
| 2.6 | Symbols, Scene Editor, Win Text, Localization, Font Maker, Rigger and Flipbook adapters | director-backend | done | Each goes through the existing storage module with `baseEtag`; a 409 is surfaced as `conflict` |

## Phase 3 — Director runtime · branch `director/worker`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 3.1 | `services/director-worker` skeleton (Node 22, pnpm workspace, Railway service, `/healthz`) | director-backend (+ infra-railway) | done | Deploys; no key in logs; `docs/INFRA.md` updated |
| 3.2 | Agent-definition loader + schema validation | director-backend | done | Rejects unknown tools and models; fixtures |
| 3.3 | Run tables + state machine (pure) + lease claim | director-backend | done | Transition-table fixture; two workers never drive one run |
| 3.4 | Turn loop: Anthropic SDK tool runner, caching, fallbacks, persisted history, resume | director-backend | done | Kill mid-run → resumes from stored messages with no duplicate ops |
| 3.5 | Checkpoints, pause, stop, owner messages via `LISTEN/NOTIFY` | director-backend | done | An idle run makes zero model calls |
| 3.6 | Mockup storage + analysis + code-side conflict rules + palette check | director-backend | done | Reference mockup set → stable breakdown; Buy bonus forced `left_out` |
| 3.7 | Spend ledger + budget cap pause | director-backend | done | A run at its cap pauses before the next call |
| 3.8 | SSE event stream | director-backend | done | Lossless reconnect with `Last-Event-ID`; heartbeats |
| 3.9 | Breakdown step: worker-driven analysis, per-image storage, conflict rules | director-backend | done | analyzeMockups + submitBreakdown before agent turn, once per attempt; answers stored per image keyed by attempt+hashes; three verdicts on facts; model-named items capped; regions list; #1067 |

## Phase 4 — Director UI · branch `director/ui`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 4.A | Owner API: run actions (create, start, pause, resume, approve, stop) + estimate + font requests | director-backend | done | Create (needs Director + Game Maker), start/pause/resume/approve/stop idempotent via requestId, estimate returns budgetCapUsd, fonts listed by R2 key; #1069 |
| 4.1 | New game screen + estimate panel | director-frontend | done | Matches mockup 02; same fields and validation as Game Maker; ownership check required; #1072 |
| 4.2 | Mockup breakdown screen | director-frontend | done | Matches mockup 03; no RunPod call before confirm; #1072 |
| 4.3 | Live run screen (steps, banner, galleries, review, activity, message box) | director-frontend | done (#1076) | Matches mockup 04; live via SSE; full width |

**Phase 4 complete.** Backend done (4A #1069), UI done (4.1–4.3 #1072 #1076).

## Phase 5 — Pipeline Changes · branch `pipeline/ui`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 5.0 | ADR-0007: pipeline-change mechanics (GitHub PR as the change record, merge strategy, revert) | director-architect | done | Approved before 5.1 (2026-10-05; eval cap $20) |
| 5.1 | Changes list + detail (files, diff link, why) | director-frontend + director-backend | done (#1070) | Matches mockup 05 |
| 5.2 | Check 1 (CI gates grouped) + Check 2 (harness report) + diff approval | director-backend + director-frontend | done (#1070) | A visible difference blocks merge until approved; approval is invalidated by a new commit |
| 5.3 | Merge with `pipelineMerge` + History + rollback (revert) | director-backend | done (#1074) | A roll back produces a revert that passes the harness |
| 5.4 | Agents tab: edit definition → branch → evaluation before/after | director-backend + director-frontend | done (#1073) | Evaluation on a fixed reference mockup set; results stored on the change |
| 5.5 | Catalogue tab: the blueprint catalogue agents read (`atlas.list_blueprints`), what is not offered and why, links to edit or add a card | director-frontend + platform-integrator | done (#1110) | Offered = exactly what an agent is served; editing stays in the Atlas Maker's card editor |

**Phase 5 complete.** Backend done (5A #1068, 5.2 #1070, 5.3 #1074), UI done (5.1 #1070, 5.4 #1073).

## Phase 8 — Blueprint-driven art · ADR-0008 (approved 2026-10-06, all defaults)

| Card | Tasks | Owner | Status | Acceptance |
|---|---|---|---|---|
| 8A | Card schema, validation, storage, history, editor + `GET /blueprints` (read adapter op) + bundled and seeded cards | atlas-python-tools | done (#1078) | Cards inert (no agent consumes them yet); catalogue draft is 7 library + 3 built-in; sync runs at boot |
| 8B | atlas-tool: render completion callback, `/saveconfig atlas_pipeline` key, `bpParams` by effective pipeline, versioned `/setoutput` file, `/duplicateatlas` safe | atlas-python-tools | done (#1081) | Director token on http 400; `/render` refuses http; scratch atlases manage layers; new per-atlas key not in human Settings |
| 8D | `atlas-technician` agent + adapter ops (18 tools) + recipes with validation + gate + refusals (library, layers, template rect, template add, global config, run-on, art deletion) + `prove:art-plan` + idle-deploy check + old preset as fallback | director-backend + regression-guardian | done (#1091, #1097, #1098, #1100, #1102, #1103, #1104); live Director-token pass owed | Technician on Sonnet 5.5 high effort; recipes stored per region with approval; plan validation before store; old preset fallback until 8C |
| 8E | Art plan checkpoint UI + "How this was made" (recipe steps, chain images, finished tile) + chain pricing in estimate + `director_blueprint_timings` measured per (pipeline, genPx) | director-frontend + director-backend | todo | Owner sees recipe groups, projects/card; can edit within card ranges; re-approval when pipeline or cost changes; before-publish lists licence-blocked steps |
| 8C | Preset UI gone, `preset_json` unread (fallback from estimate-profiles), launcher runs.ts/worker store.ts/driver.ts not read | director-frontend + director-backend | todo | Deploy only when no run non-terminal; pause and message any if needed; inert and revertable |
| 8F | Drop `preset_json` column | director-backend | todo | Column gone, cleanup complete |

## Phase 6 — Pilot

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 6.1 | Hold and Win reskin from hw-3pots-sample using the art director's mockups, owner at every checkpoint | coordinator | todo | Draft playable; owner publishes in Game Maker |
| 6.2 | Fix what the pilot reveals (each fix is a pipeline change) | per area | todo | Documented in HISTORY |
| 6.3 | Replace estimate profiles with measured ones | director-backend | todo | Estimate within ±30 % on a second run |
