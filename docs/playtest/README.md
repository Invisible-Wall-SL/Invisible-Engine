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

## The headless real clock

The Browser pane's tab is `hidden`, so rAF never fires there, and a Claude-in-Chrome tab runs only
while the owner's window is in front. For an unattended run on a real frame clock, the scripts in
`scripts/playtest/` drive Playwright's headless shell over `--remote-debugging-pipe`. They share one
launch, `scripts/playtest/headless-shell.mjs`. `win-countup-repro.mjs` is the worked example, and
its `--mode recon` boots, prints the fps and exits.

- **Install:** `npx playwright install chromium-headless-shell`, or pass `--chrome <exe>`.
- **The binary has two names.** Chrome-for-Testing builds ship `chrome-headless-shell`. Older
  Chromium builds ship `headless_shell`, and the Claude Code cloud image is one of them (under
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). The launch looks for both names in every Playwright
  browser directory.
- **As root it needs `--no-sandbox`.** Chromium will not start its sandbox as root, which is a cloud
  container's default user. The launch adds the flag only when `process.getuid()` is 0. A shell
  that exits before it answers prints its stderr.
- **Frame rate:** 60 fps with a GPU. A container has no GPU and renders in software: 4–6 fps,
  falling to 2 during a big win (measured 2026-10-02). That is slow, but the clock is real and the
  page is `visible`, so rounds still finish: idle in 9–18 s, and a 32 s big-win count-up lands on
  time. Check the `fps` a run prints before timing anything. Expect one `Web font load inactive`
  console error there, because the Typekit font does not load from a container.
- **A virtual clock instead.** `determinism-proof.mjs` boots with `?ie_determinism=<seed>` and steps frames itself, so captures are pixel-identical run to run. See "Determinism mode" in [status/engine.md](../status/engine.md).
- **"The game never reaches idle" in a container was the harness** (2026-10-02). The script found
  no `chrome-headless-shell`, or the shell would not start as root. Neither is an engine finding.

## Adding a new game

1. Copy the shape above into `docs/playtest/<game>.md`.
2. If the game isn't in [.claude/launch.json](../../.claude/launch.json), add a launch config
   (name, `cwd`, port, env) so the agent can `preview_start` it.
3. List scenarios from that game's mechanic (see `docs/playtest/lines.md` for a worked example).

## The current-games harness

Every live game is also rendered on every pipeline branch: same seed, same forced books, once with
main's runtime and once with the branch's, compared screen by screen. How to run it and read its
report: [current-games.md](current-games.md). Its screen scripts are per game TYPE
(`scripts/current-games/screens/`), not per playbook.

## Playbooks

| File | Covers |
|---|---|
| [lines.md](lines.md) | the canonical Book-of dev build (`apps/lines`, payline scoring) |
| [ways.md](ways.md) | the `ways` win model — every completed run pays and the wins SUM |
| [borut-remake.md](borut-remake.md) | the shipped Book of Borut remake |
| [hw-3pots-sample.md](hw-3pots-sample.md) | Hold and Win, Pots preset (3 Pots of Egypt) |
| [borut-pots-sample.md](borut-pots-sample.md) | Pots overlay (3 Pots preset) laid over a Book of Borut duplicate |
| [hw-classic-sample.md](hw-classic-sample.md) | Hold and Win, Classic sticky preset (Grand) |
| [hw-collector-sample.md](hw-collector-sample.md) | Hold and Win, Collector streak preset (Super Hotfire Diamonds) |

A playbook whose game and win model are decided by DIFFERENT sides (the mock's `WIN_MODEL` vs the
project's Invisible Game Config) must say so at the top and say which surfaces the cheap local boot
therefore gets wrong — `ways.md` is the worked example.
