# PLAN — Invisible Director + Invisible Pipeline Changes

**Status values:** `todo / doing / review / done`. `done` means the owner approved it.

**When a phase is done:**
- its branch(es) pass every pipeline test
- the current-games check is green, once it exists (task 1.6)
- there is a HISTORY entry
- the owner approved it

**How phases run:**
- Each phase works on its own small branches off `main`.
- PR titles use the existing scopes with a `director` detail (`launcher(director): …`, `pipeline(director): …`, `docs(director): …`), as `scripts/check-commit-scope.mjs` requires, and are squash-merged per repo convention.
- Nothing merges without the owner.

## Phase 0 — Set-up · `claude/upbeat-feynman-pwgx6a`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 0.1 | Explore the platform and record it with paths | coordinator | review | ARCHITECTURE §1 covers every item in brief §3.1 |
| 0.2 | `docs/director/` docs + root CLAUDE.md section | coordinator | review | README, SPEC, ARCHITECTURE, PLAN, HISTORY, OPEN_QUESTIONS and DECISIONS exist; CLAUDE.md section added without rewriting the rest |
| 0.3 | Six build agents in `.claude/agents/` | coordinator | review | Each has frontmatter (name, description, tools, model) and a body covering role, owns, must-not, read-first, and reporting |
| 0.4 | Seven runtime-agent drafts | coordinator | review | `services/director-worker/agents/*.md`, each with model id, role, tools, inputs/outputs, rules and checkpoint behaviour |
| 0.5 | ADR-0001…0006 (proposed) | coordinator | review | Each has context, options, recommendation, consequences and status |
| 0.6 | Owner review of Phase 0 | owner | todo | ADRs approved or changed; open questions answered |

## Phase 1 — Foundations

### Branch `pipeline/current-games-harness` (first, because every later merge depends on it)

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 1.1 | Game-list source for CI: `/api/pipeline/games` (CI-token gated, read-only) | platform-integrator | todo | A `check:` fixture shows 401 without the token, and the list equals `listGames()` |
| 1.2 | Determinism hook in the runtime: a test-only flag for clock, seed and GSAP stepping | regression-guardian (+ engine-pixi-svelte) | todo | With the flag off, the bundle hash and screenshots are unchanged; with it on, two runs give pixel-identical captures |
| 1.3 | Screen scripts per game type (`scripts/current-games/screens/<type>.json`) with forced books | regression-guardian | todo | Every live game type covered; 12–14 screens each; reviewed by the owner |
| 1.4 | Harness runner: build both runtimes, serve snapshots, capture, pixelmatch, report JSON/HTML | regression-guardian | todo | Run on main against main → 0 differences on every game, twice in a row |
| 1.5 | `current-games.yml` workflow + commit status + artifact | regression-guardian | todo | Required-able status; sharded; runtime under 15 min |
| 1.6 | Seeded proof: an intentional 1 px engine change is caught | regression-guardian | todo | The harness reports exactly the changed screens, and reverting the change turns it green |

### Branch `launcher/director-registry`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 1.7 | `director` and `pipelineChanges` in `TOOLS`; new `pipeline` stage; "new" badge; icons in the 4 toolbar twins | platform-integrator | todo | `check:toolbar-icons` passes; launcher shows CREATE and PIPELINE as in mockup 01 |
| 1.8 | `pipelineMerge` capability and role defaults (Director: Admin; Pipeline Changes: Admin + Pipeline Tester; Merge: Admin) | platform-integrator | todo | The Admin › Roles matrix matches mockup 06; a fixture covers defaults, role overrides and user overrides |
| 1.9 | Empty `/director` and `/pipeline` pages: full width, `ToolTopBar`, gated with `gate()` | platform-integrator | todo | 403 for a role without the tool; no iframe |
| 1.10 | `docs/tools/director.md`, `docs/tools/pipeline-changes.md`, README rows, `TOOL_DOC_SLUG` | platform-integrator (docs-keeper) | todo | `/docs/<slug>` renders (repo rule 9) |
| 1.11 | Costs: `anthropicAgents` provider, `director_spend` table + migration, card + monthly column; `pricing.json` | platform-integrator | todo | The card renders with $0; pricing is read from the file; a fixture computes cost for a sample `usage` incl. cache reads at 0.1× |
| 1.12 | Settings: `DIRECTOR_RUN_BUDGET_USD` (default 25) card + action | platform-integrator | todo | Validated, clamped, and degrades on a DB error, like `getRunpodIdleConfig` |

## Phase 2 — Tool adapters · branch `director/adapters`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 2.1 | Adapter gate: service token, run scope, per-agent allow-list, `director_ops` idempotency | director-backend | todo | Fixtures: wrong token 401; out-of-scope project 403; disallowed op 403; replayed `opId` returns the same result |
| 2.2 | Hard refusals (publish, game-config, roles, merge, agent defs, `published/**`) | director-backend | todo | One failing-on-purpose fixture per refusal |
| 2.3 | Game Maker adapters: get template, duplicate as project (Game Maker path) | director-backend | todo | Creates the same `projects` row + R2 tree as the `create` action + `duplicate full` |
| 2.4 | Atlas Maker adapters: list/get region, set prompt, queue variants (returns a jobRef), list variants, choose variant, pack/compose | director-backend (+ atlas-python-tools) | todo | Works against a test project; writes go through CAS; no model-side polling |
| 2.5 | atlas-tool pipeline change: render completion callback + resumable still queue | atlas-python-tools | todo | Restart during a render → the job resumes or re-queues once; Python tests pass |
| 2.6 | Symbols, Scene Editor, Win Text, Localization, Font Maker, Rigger and Flipbook adapters | director-backend | todo | Each goes through the existing storage module with `baseEtag`; a 409 is surfaced as `conflict` |

## Phase 3 — Director runtime · branch `director/worker`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 3.1 | `services/director-worker` skeleton (Node 22, pnpm workspace, Railway service, `/healthz`) | director-backend (+ infra-railway) | todo | Deploys; no key in logs; `docs/INFRA.md` updated |
| 3.2 | Agent-definition loader + schema validation | director-backend | todo | Rejects unknown tools and models; fixtures |
| 3.3 | Run tables + state machine (pure) + lease claim | director-backend | todo | Transition-table fixture; two workers never drive one run |
| 3.4 | Turn loop: Anthropic SDK tool runner, caching, fallbacks, persisted history, resume | director-backend | todo | Kill mid-run → resumes from stored messages with no duplicate ops |
| 3.5 | Checkpoints, pause, stop, owner messages via `LISTEN/NOTIFY` | director-backend | todo | An idle run makes zero model calls |
| 3.6 | Mockup storage + analysis + code-side conflict rules + palette check | director-backend | todo | Reference mockup set → stable breakdown; Buy bonus forced `left_out` |
| 3.7 | Spend ledger + budget cap pause | director-backend | todo | A run at its cap pauses before the next call |
| 3.8 | SSE event stream | director-backend | todo | Lossless reconnect with `Last-Event-ID`; heartbeats |

## Phase 4 — Director UI · branch `director/ui`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 4.1 | New game screen + estimate panel | director-frontend | todo | Matches mockup 02; same fields and validation as Game Maker; ownership check required |
| 4.2 | Mockup breakdown screen | director-frontend | todo | Matches mockup 03; no RunPod call before confirm |
| 4.3 | Live run screen (steps, banner, galleries, review, activity, message box) | director-frontend | todo | Matches mockup 04; live via SSE; full width |

## Phase 5 — Pipeline Changes · branch `pipeline/ui`

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 5.0 | ADR-0007: pipeline-change mechanics (GitHub PR as the change record, merge strategy, revert) | director-architect | todo | Approved before 5.1 |
| 5.1 | Changes list + detail (files, diff link, why) | director-frontend + director-backend | todo | Matches mockup 05 |
| 5.2 | Check 1 (CI gates grouped) + Check 2 (harness report) + diff approval | director-backend | todo | A visible difference blocks merge until approved; approval is invalidated by a new commit |
| 5.3 | Merge with `pipelineMerge` + History + rollback (revert) | director-backend | todo | A roll back produces a revert that passes the harness |
| 5.4 | Agents tab: edit definition → branch → evaluation before/after | director-backend + director-frontend | todo | Evaluation on a fixed reference mockup set; results stored on the change |

## Phase 6 — Pilot

| # | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| 6.1 | Hold and Win reskin from hw-3pots-sample using the art director's mockups, owner at every checkpoint | coordinator | todo | Draft playable; owner publishes in Game Maker |
| 6.2 | Fix what the pilot reveals (each fix is a pipeline change) | per area | todo | Documented in HISTORY |
| 6.3 | Replace estimate profiles with measured ones | director-backend | todo | Estimate within ±30 % on a second run |
