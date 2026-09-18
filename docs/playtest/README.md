# Playtest playbooks

A **playbook** tells the `game-playtester` agent how to play one game and what "correct" means.
One file per game: `docs/playtest/<game>.md`. The agent reads it, drives the game in the browser
preview, checks the assertions, and (with fix authority) repairs and re-verifies what breaks.

Keep a playbook **declarative and evidence-based**: every scenario names an action to perform and
a signal that proves pass/fail (a console state, a network response, a book-vs-render match, a
stage-graph assertion). If a check can only be judged by eye, mark it **human-eyes** — the agent
reports it but does not pass/fail it (see the visual-limits note in `.claude/agents/game-playtester.md`).

## File shape

```markdown
# Playtest — <game>

- **Launch:** `preview_start { name: '<config from .claude/launch.json>' }` (port <n>)
- **RGS:** mock test-server (`services/test-server`) · force outcomes via <books | setBoardOverride>
- **Build:** dev / __IE_DEBUG__ on (SymbolDebugOverlay + `d` hotkey available)

## Scenarios

### S1 — <name>
- **Do:** <clicks / bet changes / bonus buy>
- **Expect:** <assertion + the signal that proves it>
- **Force:** <which book / override pins this outcome>

### S2 — …
```

## Writing good scenarios

- **Force the outcome, don't gamble on RNG.** Name the mock book or `setBoardOverride` that pins
  free-spins / near-miss / max-win so the run is repeatable.
- **State the proving signal.** "totalWin animates" is not checkable; "final balance == interim +
  book.payout, and no `error` console line" is.
- **Cover the round contract**: spin → reveal → winInfo → setTotalWin → back to idle; free-spin
  trigger → counter decrements each spin → outro fires → returns to base game.
- **Cover the money math**: read the book the RGS returned and assert the rendered win/balance
  matches (highest-value check — a slot's correctness is the book→animation contract).
- **Cover regressions you've hit before**: turn a fixed bug into a permanent scenario so it can't
  come back (e.g. the free-spin outro that renders nothing without the count-up cue).

## Adding a new game

1. Copy the shape above into `docs/playtest/<game>.md`.
2. If the game isn't in [.claude/launch.json](../../.claude/launch.json), add a launch config
   (name, `cwd`, port, env) so the agent can `preview_start` it.
3. List scenarios from that game's mechanic (see `docs/playtest/lines.md` for a worked example).

## Playbooks

| File | Covers |
|---|---|
| [lines.md](lines.md) | the canonical Book-of dev build (`apps/lines`, payline scoring) |
| [ways.md](ways.md) | the `ways` win model — every completed run pays and the wins SUM |
| [borut-remake.md](borut-remake.md) | the shipped Book of Borut remake |

A playbook whose game and win model are decided by DIFFERENT sides (the mock's `WIN_MODEL` vs the
project's Invisible Game Config) must say so at the top and say which surfaces the cheap local boot
therefore gets wrong — `ways.md` is the worked example.
