# particlespin — game brief

A live published project, `particlespin`, about which the repo records almost nothing. Owner
agent: `lines-games` ([family](../families/lines.md)), inferred (below).

## What it must be

- Purpose, theme, math and client: not recorded in the repo. The name alone says nothing reliable
  (the Invisible FX "particle spin" setting is a tool option, not this game).

## Kind and add-ons

- Kind: not recorded. Inferred: `scripts/current-games/costs.json` seeds its `fs-transition` and
  `big-win-intro` costs (2026-10-14), two scenarios only `lines.json` and `bookOf.json` have, so it
  plays one of those two scripts; both kinds belong to `lines-games`. Add-ons: not recorded.

## Where it lives

- Content: `<client>/particlespin/` in R2, snapshots under `…/published/` (`docs/INFRA.md`); the
  client folder is not recorded.
- No desktop build recorded.

## How it is tested

- Playbook: none.
- Current games: rendered every pipeline PR with its kind's script (`scriptFor`,
  `scripts/current-games/lib/plan.mjs`). It is absent from the 2026-10-05 measured costs; only its
  two seeded costs are listed, so its other scenarios are planned by the heuristic in `plan.mjs`.

## State and quirks

- Owner-facing state and known quirks: not recorded.
- First action for an agent touching it: read its `runtime.json` / Game Config read-only and its
  current-games rows, then fill in this brief.
