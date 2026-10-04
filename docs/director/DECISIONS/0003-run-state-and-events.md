# ADR-0003 — Run state and events

- **Status:** approved (2026-10-04, owner)
- **Date:** 2026-10-04

## Context

A run has five steps, configurable checkpoints, Pause, Stop, owner messages, and a live UI (Activity
feed, gallery statuses, spend, waiting banner). It must survive redeploys of the launcher and the
worker.

The platform's existing long jobs keep their state in memory (`publishAllJob.ts`), and that state is
lost on restart. There is no SSE pattern in the launcher today; pages poll.

## Options

- **State:**
  - (a) In memory in the worker. Lost on restart, so no.
  - (b) Postgres rows, with the worker as the single writer of state transitions. Recommended.
  - (c) R2 JSON docs. Workable, but awkward to query, and we already have Postgres.
- **Live updates:**
  - (a) The page polls.
  - (b) Server-Sent Events from the launcher, fed from an append-only events table. Recommended.
  - (c) WebSockets. More moving parts on Railway, for no gain.

## Recommendation

### Tables (Drizzle migrations in `L/drizzle/`)

- **`director_runs`:**
  - id, projectKey, clientKey, templateProjectKey, presetJson, startingPointJson, checkpointsJson
  - ownerUserId
  - status: `draft | running | waiting | paused | stopping | stopped | failed | handed_off`
  - step: `breakdown | style_pack | regions | build | handoff`
  - budgetCapUsd
  - lease columns: leaseHolder, leaseUntil
  - createdAt, updatedAt
- **`director_events`:** append-only. Holds id (bigserial), runId, at, agent, kind, payloadJson, and
  tool.
  - Kinds: `activity`, `owner_message`, `checkpoint_open`, `checkpoint_resolved`, `region_status`,
    `job_queued`, `job_done`, `spend`, `error`.
- **`director_messages`:** the per-agent conversation history (append-only, one row per message,
  content as JSON). Turns are resumed from it.
- **`director_regions`:** runId, region, group, status (`queued | drafting | to_review | approved |
  rejected`), variants, artDirectorPickJson, ownerNote.
- **`director_ops`** (ADR-0002) and **`director_spend`** (ADR-0006).

### State machine

The worker owns transitions; it is implemented as a pure function with fixture tests.

```
draft ─start→ running ─checkpoint→ waiting ─owner confirm→ running
running ─owner pause / budget cap→ paused ─resume→ running
any ─stop→ stopping ─(in-flight GPU jobs cancelled)→ stopped
build done → waiting(before_publish, always) → handed_off
```

### Owner actions

The launcher form actions **insert rows**:
- `owner_message`
- `checkpoint_resolved` (with the decision and note)
- a pause, resume or stop request

The worker reacts. The page never mutates run state directly.

### Wake-up

- The worker `LISTEN`s on a Postgres channel (`director_wake`). Every inserted owner event and every
  `job_done` sends a `NOTIFY`.
- As a fallback, the worker sweeps for runs with unhandled events every 60 s.
- An idle run (waiting for the owner or a GPU job) holds no model call open and costs nothing.

### Resume after restart

- On boot the worker re-claims runs whose lease has expired.
- Each agent's next turn is built from `director_messages`, so nothing is replayed.
- In-flight GPU jobs are re-attached by `jobRef` (ADR-0002).

### Live UI

- `GET /director/[runId]/events` streams SSE from `director_events` after `Last-Event-ID`. The
  launcher tails the table on `LISTEN`.
- The page renders the Activity feed, gallery statuses, spend and the banner from events plus one
  initial `load`.
- Reconnects are lossless via `Last-Event-ID`.

## Consequences

- Six new tables and their migrations.
- One new SSE route, which needs a Railway proxy timeout check (SSE heartbeats every 15 s).
- The state machine and resume logic are fixture-tested before any UI exists.

## Needs owner approval

- Postgres as the single source of run state, and SSE for the live view.
