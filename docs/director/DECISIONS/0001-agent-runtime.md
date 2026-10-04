# ADR-0001 — Agent runtime

- **Status:** approved (2026-10-04, owner)
- **Date:** 2026-10-04
- **Author:** coordinator (Phase 0)

## Context

Seven runtime agents work inside the product (SPEC §1.4). They call only the platform's own tools,
through adapters (ADR-0002). A run lasts tens of minutes to hours. Most of that time is spent waiting:
for GPU jobs, and for the owner at checkpoints. Runs must survive a Railway redeploy, because every
push to main redeploys every service.

What exists today:
- **Anthropic SDK:** the launcher already depends on `@anthropic-ai/sdk` (`translate.ts`).
- **Key:** `ANTHROPIC_API_KEY` is a server env var (`env.ts`).
- **No job runner:** there is no queue or worker. In-process jobs such as `publishAllJob.ts` are lost
  on restart.

### Model API facts that constrain the choice

- **Opus 5.5:** thinking cannot be disabled. Effort defaults to `medium`. Forced `tool_choice`
  (`any` / `tool`) returns 400.
- **Sonnet 5.5:** forced `tool_choice` returns 400. To turn thinking off, send `between_tools`.
- **Haiku 4.5:** uses `budget_tokens` thinking, not adaptive.

So every agent must steer tools with `tool_choice: auto`, `strict: true` schemas and prompt instructions.

## Options

1. **Claude Agent SDK as a server-side worker.**
   - What it is: the Claude Code harness as a library, with built-in Read/Write/Edit/Bash/Grep/Web
     tools, subagents, hooks and sessions.
   - Pros:
     - batteries included
     - hooks for approval gates
     - session resume
   - Cons:
     - Our agents must have *no* file system, shell or web. Every built-in would have to be disabled
       and kept disabled across SDK upgrades.
     - The harness's own context management and prompts sit between us and the per-call `usage` we
       need for per-agent costs.
     - Platform tools would still be exposed as an in-process MCP server.
2. **Claude Managed Agents + the adapters as a remote MCP server.**
   - What it is: Anthropic runs the loop and a per-session sandbox. Agents are stored, versioned
     objects.
   - Pros:
     - no loop code
     - versioned agent configs
     - SSE events
     - session budgets
   - Cons:
     - It needs a public, authenticated MCP endpoint into the launcher, which is new attack surface.
     - The per-session container is unused, because we want no sandbox tools.
     - Agent definitions would live in Anthropic's store, not in git, so the "an agent edit is a
       pipeline change with a branch" rule needs a sync step (`ant apply`).
     - It is beta.
3. **Anthropic SDK (TypeScript) tool runner in our own worker** — the Messages API with
   user-defined tools.
   - Pros:
     - The only tools that exist are the adapters. There is nothing to fence off.
     - Per-turn hooks give us checkpoint gates, hard refusals, budget checks and retry policy.
     - Every response's `usage` is in hand for exact per-agent cost.
     - Prompt caching is under our control (frozen system prompt + tool list).
     - Agent definitions are plain files in git, so the Agents tab is a branch editor.
     - Run state lives in our Postgres, so a restart resumes from the last persisted turn.
   - Cons:
     - We own the loop and its resume logic.
     - No managed sandbox. We don't want one.

## Recommendation

**Option 3: a new Railway service `services/director-worker`.** It is a Node 22 TypeScript service in
the pnpm workspace that runs the Anthropic SDK tool runner. It sits next to the launcher and uses the
same Postgres.

How it works:
- **Run start:** the launcher writes a `director_runs` row. The worker claims it with
  `SELECT … FOR UPDATE SKIP LOCKED` and a lease column, so only one worker drives a run.
- **Agent definitions:** each agent is `services/director-worker/agents/<name>.md` (YAML frontmatter:
  `name`, `model`, `effort`, `tools`, `role`, `inputs`, `outputs`; body = system prompt). They are
  loaded at boot. Changing one is a pipeline change.
- **Turns:** each agent turn is one `messages.stream` call:
  - adaptive thinking where the model supports it, and `budget_tokens` for Haiku
  - `tool_choice: auto` with `strict` tools
  - the system prompt and tools cached with `cache_control`
- **History:** conversation history is persisted after every turn (append-only, so preserved
  thinking stays valid). A restart replays nothing; it continues from the stored messages.
- **Refusals:** use the server-side fallback (`fallbacks: "default"` on the Opus/Sonnet 5.5 models).
  A final `refusal` stop pauses the run and shows the reason.
- **API key:** `ANTHROPIC_API_KEY` is set only on the worker service. The launcher never calls the
  agents' models.

Why not the Agent SDK: we would spend effort *removing* its tools and still not get clean per-call
usage.

Why not Managed Agents: it moves agent definitions out of git and needs a public MCP surface into the
platform. It is a good fit later if we want managed scheduling; ADR-0002's adapter contract is
MCP-shaped so that a later move is cheap.

## Consequences

- New service:
  - a Railway service and env vars (`ANTHROPIC_API_KEY`, `DATABASE_URL`, `DIRECTOR_SERVICE_TOKEN`)
  - a `/healthz` endpoint
  - an `infra-railway` change, plus `docs/INFRA.md` and the `/deploy` skill
- We write and test the resume logic (ADR-0003).
- Model ids live only in agent frontmatter. Prices live only in config (ADR-0006).

## Needs owner approval

- The choice of option 3 over the brief's default (option 1).
- A new Railway service.
