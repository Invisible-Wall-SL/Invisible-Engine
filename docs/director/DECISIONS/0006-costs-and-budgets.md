# ADR-0006 — Costs and budgets

- **Status:** proposed
- **Date:** 2026-10-04

## Context

Spend has to be recorded per run and per agent and shown on a new "Anthropic (agents)" card in
Admin › Costs, with its own column in the monthly table. Each run has a budget cap (default $25, set
in Settings). Hitting the cap pauses the run and asks the owner. Estimates are shown before the run
starts. Prices come from config.

What exists:
- `costs/` collectors: `ProviderId` and `getCosts()`.
- `costs/anthropic.ts` reads the **org-wide** Anthropic cost report with an admin key. It can't
  separate agent spend from translation spend.
- `cost_months` for the monthly table.
- `app_settings` for settings.
- RunPod cost is read from the account balance and per-pod $/h. There is no per-job tracking.

## Recommendation

### Prices config

- Prices live in `services/director-worker/pricing.json`, a reviewed file. Changing it is a pipeline
  change. They are read by the worker and by the launcher's estimator.

  ```json
  { "currency": "USD", "perMTok": {
      "claude-opus-5-5":           { "input": 4, "output": 20 },
      "claude-sonnet-5-5":         { "input": 2, "output": 10 },
      "claude-haiku-4-5-20251001": { "input": 1, "output": 5 } },
    "cacheReadMultiplier": 0.1, "cacheWriteMultiplier": 1.25 }
  ```

- An optional `app_settings` override lets prices change without a deploy.

### Ledger

- `director_spend` holds:
  - runId, agent, model, at
  - input, output, cacheRead and cacheWrite tokens
  - usd
  - kind: `claude | runpod`
- Each Messages response's `usage` is written once.
  - A turn served by a refusal fallback is billed at the fallback model's price (the model is
    reported per iteration).
- RunPod spend per job comes from the serverless job's `executionTime` × the endpoint's $/s, as
  configured in the same pricing file.

### Costs card

- A new `ProviderId` `anthropicAgents`, with a collector that sums `director_spend` month-to-date.
- The card shows:
  - MTD spend
  - spend by agent
  - the top runs
- The monthly table gets the column through the existing `recordAndLock`.
- The existing org-wide `anthropic` card stays as it is. Its total includes agent spend, and the card
  says so in a note.

### Budget cap

- The `app_settings` key `DIRECTOR_RUN_BUDGET_USD` (default 25) uses the `getRunpodIdleConfig()`
  pattern and gets a Settings card.
- The value is copied onto the run at start, so changing the setting doesn't move running runs.
- Before every model call and every GPU submit, the worker checks:
  `spent + projected(next call) ≥ cap` → status `paused`, plus a `checkpoint_open`
  (kind `budget`) asking the owner to raise the run's cap or stop.

### Estimate

The New-game panel computes the estimate before the run starts, from:
- the template's region counts × variants per region × per-region token profiles (seeded from
  measured pilot runs, starting from a conservative table)
- the mockup count
- the RunPod minutes per variant at the preset resolution

It is shown as a range, e.g. "~$6–12".

## Consequences

- One table and one collector.
- Prices never appear in code.
- Estimates are rough until the pilot (Phase 6) gives real profiles.

## Needs owner approval

- Prices in a repo file (a pipeline change to edit) with an Admin override.
- The cap is snapshotted per run.
