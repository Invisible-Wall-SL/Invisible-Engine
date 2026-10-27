# test1 — game brief

A test project on the shared runtime, used as the canary for engine releases; its desktop build is
`test1build`. Owner agent: `lines-games` ([family](../families/lines.md)), inferred (below).

## What it must be

- A test game, not a client title: the release runbook pins a test game "(e.g. `test1`)" to a new
  runtime release before it is promoted to everyone
  ([games-deploy](../../design/games-deploy.md), "Canary"). It was pinned that way in the
  2026-09-29 rollback drill ([engine status](../../status/engine.md)).
- First target of Game Maker Phase 0 (2026-06-16): the headless gate that proved a project boots
  from a live fetch (`docs/history.md`, read only).
- Client: `invisible_wall` per its tool staging path (`invisible_wall/test1`, `docs/history.md`
  B26). Theme, math and end client: not recorded.

## Kind and add-ons

- Kind: not recorded. Inferred: `scripts/current-games/costs.json` lists for it the six scenarios
  only `lines.json` and `bookOf.json` have (incl. fs-transition, big-win-intro), so it plays one
  of those two scripts, and both kinds belong to `lines-games`. No `pots` scenario.
  Add-ons: none recorded.

## Where it lives

- Content: `invisible_wall/test1/` in R2; snapshots under `…/published/` (`docs/INFRA.md`).
- **Desktop build `test1build`:** its own thin repo (engine submodule) and bundle. Built before
  2026-09-16, it sends `[5, betPerLine]` whatever the table says, so the test server keeps dealing
  it the line-config game (`sellableGrid`, `services/test-server/makeMock.mjs`) until it is rebuilt
  and stamped table-capable. Still on the old 1080×1080 / 1200×1023 canvases until its next build
  (symbols history). The repo's Svelte pins were fixed at rest on 2026-10-13 (`test1#1`).
- Which project `test1build` pins (`projectKey`): not recorded in the repo.

## How it is tested

- Playbook: none of its own; [lines.md](../../playtest/lines.md) covers the `apps/lines` dev
  build, not this project.
- Current games: rendered with its kind's script (`scriptFor`,
  `scripts/current-games/lib/plan.mjs`); `test1build` is not rendered (own bundle), only build and
  tests are checked.
- As the canary: play it after `pin`, then `promote` and `unpin` (games-deploy runbook).

## State and quirks

- The project-scoping incident: edits made with another active project saved there, and the
  published `test1` served its own stale doc
  ([project-explicit-tool-scoping](../../design/project-explicit-tool-scoping.md)).
- Ships an edited `freeSpinCounter` and copies of `loadingBar`, `tapToContinue`, `textBox` and the
  Hold and Win parts, not of `button` (current-games 1G).
- Not in the test2–test6 free-spin intro/outro migration list.
