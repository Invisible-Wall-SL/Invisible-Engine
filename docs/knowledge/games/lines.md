# lines — game brief

A published project named `lines` on the shared runtime (not the `apps/lines` runtime itself).
Owner agent: `lines-games` ([family](../families/lines.md)), inferred (below).

## What it must be

- Purpose, theme, math and client: not recorded in the repo.
- Do not confuse it with `apps/lines`, the one shared runtime every online game boots, or with the
  `lines` kind (the default kind). This is one live game that the harness renders under the key
  `lines`.

## Kind and add-ons

- Kind: not recorded. Inferred: `scripts/current-games/costs.json` lists for it the six scenarios
  only `lines.json` and `bookOf.json` have (base, line-win, free-spins, big-wins, fs-transition,
  big-win-intro), so it plays one of those two scripts; both kinds belong to `lines-games`.
  No `pots` scenario. Add-ons: none recorded.

## Where it lives

- Content: `<client>/lines/` in R2, snapshots under `…/published/` (`docs/INFRA.md`); the client
  folder is not recorded.
- No desktop build recorded.

## How it is tested

- Playbook: none of its own. [lines.md](../../playtest/lines.md) is the playbook for the
  `apps/lines` **dev build** with the book mock, not for this project.
- Current games: rendered every pipeline PR (`scriptFor` picks the script by kind,
  `scripts/current-games/lib/plan.mjs`). Measured cost: its `base` canary takes ~120 s a side
  (`costs.json`).
- The 1 px win-line proof flagged `line-win` on ten of the twelve rendered games, all but
  `hw-classic-sample` and `test3` ([current-games](../../playtest/current-games.md), "Measured on
  the live games").

## State and quirks

- Ships an edited `freeSpinCounter` and copies of `loadingBar`, `tapToContinue`, `textBox` and the
  Hold and Win parts, not of `button` (current-games 1G): a change to `button` does not reach it
  on republish; a change to those copied defs does.
- Its snapshot's built-in copies are from engine `e29a993`; republishing picks up every built-in
  change since ([open question 2](../../director/OPEN_QUESTIONS.md)).
- Owner-facing state and known quirks: not recorded.
