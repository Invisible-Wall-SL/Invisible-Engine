# bookofborutremake — game brief

Book of Borut remake, the shipped western Book-of slot on the shared runtime. Owner agent:
`lines-games` ([family](../families/lines.md)).

## What it must be

- A 5×3, 10-payline Book-of slot with the Book of Thermopylae numbers: the book (`SCAT`) is
  scatter and wild, free spins draw one expanding special, one 100× buy ("Gold Rush")
  ([book-feature](../../design/book-feature.md) §1, §8).
- Client: `invisible_wall`. Commercial owner or partner: not recorded.
- Never touched by tests or samples: [borut-pots-sample](../../playtest/borut-pots-sample.md) is
  its duplicate, so the live remake is never given the pots overlay.

## Kind and add-ons

- Kind `bookOf` (retired; it is now Lines + the Book of Thermopylae preset). The `/admin` Book-of
  migration that moves it to `lines` is built, **not yet run**
  ([game-config status](../../status/game-config.md), "Book-of migration").
- Dealt by the `book` mock on the test server until that migration republishes it.
- Add-ons: none (no pots overlay, no bonus modes).

## Where it lives

- Content: `invisible_wall/bookofborutremake/` in R2 (`editor/scenes.json`, `config/config.json`,
  …); published snapshots under `…/published/` (`docs/INFRA.md`, R2 key layout).
- Online: `games.invisiblewall.org/bookofborutremake/`, booting `runtime:lines`.
- **Desktop build `bookofborutremakebuild`:** the same game built from its own thin repo with the
  engine as a submodule; own bundle in `test_server/bookofborutremakebuild/`, `book` in the
  manifest. Runbook step 1 of the migration: rebuild it on an engine from 2026-10-08 or later and
  stamp it table-capable before the migration runs.

## How it is tested

- Playbook: [borut-remake.md](../../playtest/borut-remake.md) (live URL with a secret read token
  supplied at run time; real clicks or the headless real clock; outcomes cannot be forced live).
- Current games: rendered with
  [`bookOf.json`](../../../scripts/current-games/screens/bookOf.json); its `pots` scenario runs
  only for a contract with `grid.potsOverlay`, which this game must never get.
  `bookofborutremakebuild` is not rendered (own bundle): only build and tests are checked.
- Gates: `pnpm check:rgs` (incl. `check:book-paytable`), `check:resume`.

## State and quirks

- Free-spin intro, book reveal and two-stage outro tap pass live (2026-09-28,
  [flow status](../../status/flow.md)). Authored paytable matches the server (2026-09-28).
- By design: no retrigger "+10" overlay. Known: the hamburger menu does nothing (submenu not
  built). The mid-round refresh crash was the mock restarting, deprioritized.
- Content to watch: buy-menu tiles once showed off-theme placeholder copy (2026-07-21).
- Standalone-Borut-only flourishes are absent on `runtime:lines`: a gap, not a failure.
- Its snapshot carries built-in component copies from engine `e29a993`; a republish picks up every
  built-in change since ([open question 2](../../director/OPEN_QUESTIONS.md)).
- The desktop bake once lacked flow-v2 (fixed 2026-07-27, `engine-history.md`).
