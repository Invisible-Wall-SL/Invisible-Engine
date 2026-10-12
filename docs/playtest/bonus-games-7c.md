# Playtest — bonus games Phase 7c (samples + the new layers, in a real browser)

The first browser play of the bonus-games model (design [bonus-games.md](../design/bonus-games.md)
§0; hub [status/bonus-games.md](../status/bonus-games.md)). Run 2026-10-09 against `main` 0cc277d
(7b merged), in a Claude Code cloud container. Everything was local, and nothing was written to R2.

## How it was run

- **Runtime:** `apps/lines` built as `runtime-release.yml` builds it (`PUBLIC_RGS_TRANSPORT=play4fun`,
  `PUBLIC_DELIVERY_PROFILES='*'`).
- **Driver:** [`scripts/playtest/sample-play.mjs`](../../scripts/playtest/sample-play.mjs), new in
  this change, built on the current-games harness (`scripts/current-games/lib`):
  - The snapshot is served as the launcher serves it. The real Invisible Test Server (local mode)
    deals from the game's manifest entry through the **authoring** channel, so forced beats work.
  - Chromium headless shell, `?ie_determinism=7`, 1280×720.
  - It plays a plan round by round. Per round it records every RGS request and answer, the probe
    state, console errors and screenshots, then checks two things:
    - **money:** balance after = before − stake + `gameRoundOver.win`;
    - **HUD:** the HUD win equals the paid win.
  - Round options (header of the script): `force`, `clicks` (a buy), `midShots`, `holdCheck` (manual
    respins), `reloadOnEvent` / `cutAfterPlays` (a dropped connection, then the facade's resume) and
    `reload`.
- **Published samples (part 1):** downloaded read-only from R2 (`CURRENT_GAMES_R2_*`): the pointer's
  snapshot and the `test_server/games.json` entry. All four were published **before 7b** (Classic,
  3 Pots and Collector at engine a3ae0e6 with the mirror, Borut at 72f7a0c). So every run below also
  proves 7b's runtime normalize and the test server's legacy-contract read.
- **New layers (parts 2–3):** a **local launcher**:
  - `apps/launcher-api` production build (`node scripts/start.mjs`);
  - Postgres 16 in the container;
  - a local S3 stand-in (moto) seeded by a read-only copy of the four sample projects and `_shared/`.

  The games were built through the launcher's own endpoints and pages: Game Maker's create action,
  `/config` (Playwright UI), "Add a bonus mode…" and Re-sync (dialog UI), the Scene Editor's "Add
  missing screens", Flow's "Add overlay steps", and Publish. Each published snapshot was then played
  with the driver.

**Environment noise (not findings):**

- `Web font load inactive`: Typekit is unreachable from the container.
- Games made from the Lines template log `Sprite: key "invisible_wall/test6/…UI_0005_WidgetBig" is
not found`: the template's `test6` art was not copied to the local store.
- Projects whose imported or preset symbols have no `/symbols` binding warn that those symbols
  "render as nothing", which is the import's own note: bind them in `/symbols`.

## Results

| Case                                                                                            | What was played                                                                                                                                                                                                                                                                                                                                                                                              | Result                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. hw-classic-sample** (published, R2)                                                        | S1 base · S2 trigger · S3 BOOST · S3b instant · S4 letter · S5 GRAND letters · S6 MAJOR · S7 chain + dead · S8 random metre, Buy Bonus, Super Buy · `lucky` refused                                                                                                                                                                                                                                          | **pass**: 13 rounds, money and HUD exact, 0 errors / stalls ([win](bonus-games-7c/hw-classic-win.jpg), [GRAND](bonus-games-7c/hw-classic-grand.jpg))                               |
| **1. hw-3pots-sample** (published, R2)                                                          | S1–S7: trigger, payer / multiplier / collector, mystery MINI, unlock, red / blue / green meters, Lucky Spin, full-board GRAND · addRespins / unlock:1 refused                                                                                                                                                                                                                                                | **pass**: 14 rounds ([red meter](bonus-games-7c/hw-3pots-meter-red.jpg))                                                                                                           |
| **1. hw-collector-sample** (published, R2)                                                      | S1 instant · S2 pattern + wheel · S3 streak · S4 wheel coinBoost / MINOR · S5 GRAND · S6 dead + extraCollect                                                                                                                                                                                                                                                                                                 | **pass**: 7 rounds ([respins](bonus-games-7c/hw-collector-respins.jpg))                                                                                                            |
| **1. borut-pots-sample** (published, R2)                                                        | drops, red pot → Hold and Win, 6 coins, 5 coins, `pot:red,feature` (Borut's free spins, then the pot's Hold and Win), pot levels across rounds + reload, refusals, 10 random spins                                                                                                                                                                                                                           | **pass**: 25 rounds ([red pot](bonus-games-7c/borut-pot-red.jpg)). The published sample has **one pot (red)**, so the playbook's blue / green steps are refused (playbook updated) |
| **1. plain lines + free spins** (local)                                                         | Lines template: 3 base spins, 2 forced free-spin rounds. Ways template: 3 base, 2 free-spin rounds (one retrigger)                                                                                                                                                                                                                                                                                           | **pass**                                                                                                                                                                           |
| **1. old bundles boot their Hold and Win**                                                      | every R2 sample above is a pre-7b bundle (Borut's has only the legacy `holdAndWin` / `potsOverlay` keys)                                                                                                                                                                                                                                                                                                     | **pass**: `__IE_RUNTIME_STALE__` null, every feature played                                                                                                                        |
| **2a. plain Hold and Win**, Jackpots On / Off (Game Maker template)                             | base, trigger, MINI, GRAND, chain, dead. Off: `jackpot:*` refused (no tiers)                                                                                                                                                                                                                                                                                                                                 | **pass**                                                                                                                                                                           |
| **2b. Lines + 3 Pots → Hold and Win**, Automatic and Manual (`play: 'manual'` set in `/config`) | each pot, 6 coins, 5 coins. 900 frames with no input once the feature is in                                                                                                                                                                                                                                                                                                                                  | **pass**: Automatic moved in 15 of 15 slices, Manual in **0 of 15** (it waits on SPIN), same totals ([held](bonus-games-7c/manual-respins-held.jpg))                               |
| **2c. Lines + spins mode** (Ways, own grid 6×4, 5 spins; blue pot), made in `/config`           | entry, 5 spins on 6×4, exit to 5×3 ([6×4](bonus-games-7c/spins-mode-6x4.jpg)); with the mode's screens: `freeSpinIntro/Counter/Outro-spinsBonus` mount and the spin button is locked under the intro ([intro](bonus-games-7c/spins-mode-intro.jpg)); a dropped connection mid-mode, then reload: the round is replayed at the same `seq` / `gid`, finished, collected, HUD exact                             | **pass after the fix below** (**bug**: the next round hung)                                                                                                                        |
| **2d. plain Hold and Win + 3 Pots / Collector presets**                                         | each pot (`pot:<id>`; this mock takes pot forces, not `meter:`)                                                                                                                                                                                                                                                                                                                                              | **pass**                                                                                                                                                                           |
| **2e. "Add a bonus mode…" → another project's Ways base game as a spins mode, then Re-sync**    | dialog: source, "Base game (ways), as N spins", green pot ([dialog](bonus-games-7c/gm-add-bonus-mode.jpg)); symbols renamed `_2`. Source edited (rows 3→4, H1 5-of-a-kind 10→50), then Re-sync: the host's mode picked up both. Played: 10 spins on 5×4                                                                                                                                                      | **pass after the fix below** (same hang after it)                                                                                                                                  |
| **2f. the tools for a spins mode**                                                              | `/config` spins-mode editor ([shot](bonus-games-7c/config-spins-mode.jpg)); Scene Editor "Add missing screens (3)" adds the three `(Spins bonus)` copies and its mode picker gains Spins bonus; Flow "Add overlay steps" adds a Spins bonus tab, valid ([shot](bonus-games-7c/flow-spins-tab.jpg)); Win Text lists "Spins bonus (spinsBonus) — spins mode"; `/symbols` chips "Base game (p7c-ways-src) only" | **pass**. The info page per mode was not opened in the browser; `check:spins-modes-tools` covers it                                                                                |
| **3. migration on save**                                                                        | each sample's stored doc saved in `/config` (an RTP edit and its revert, two saves), then republished locally and replayed with the same seed and forces                                                                                                                                                                                                                                                     | **pass**: answers byte-identical (Classic 13/13, 3 Pots 14/14, Collector 7/7, Borut 25/25)                                                                                         |

### What a real save of each sample changes (3)

| Sample                                                  | Stored doc today                                                            | After a save in `/config`                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| hw-classic-sample, hw-3pots-sample, hw-collector-sample | legacy only (`holdAndWin`, no split form; last saved 1 Oct, before Phase 1) | `holdAndWin` removed; `coinOverlay` + `modes` written (the split form); `updatedAt` moves. Every other key is byte-identical |
| borut-pots-sample                                       | mirror era (`holdAndWin` + `potsOverlay` + `coinOverlay` + `modes`)         | `holdAndWin` and `potsOverlay` removed; `coinOverlay` and `modes` byte-identical; `updatedAt` moves                          |

Every save validated with no issue and no warning. The migrated doc deals exactly what the stored
legacy doc deals (table above).

**Two things a republish changes that are not the migration:**

- **Borut's mock protocol** becomes `lines`. It is `book` in the 8 Oct manifest, and Book-of is now
  a Lines preset (book-feature).
- **Borut's paylines and stake:** the doc was edited after its 8 Oct publish, so a republish ships
  that edit as well.

## Issues

### Fixed: the first round after a spins mode could roll forever

- **Symptom.** After a spins bonus mode with a grid of its own had played, the next round that
  pre-spins never settled. The reels kept rolling, STOP showed, `idle` stayed false, and there was
  no error. It happened after a reload mid-mode, after a plain spins round, and after an imported
  spins mode, whatever the next round was (Borut-style free spins or Hold and Win)
  ([stuck](bonus-games-7c/spins-next-round-stuck.jpg)).
- **Cause.** Two pieces don't fit:
  - `Board.svelte` installed every reel's ready-to-spin hook (`enhancedBoard.readyToSpinEffect`)
    once, at mount.
  - A spins mode rebuilds the board on entry and on exit (`syncSpinsBoard` → `rebuildBoard`, which
    splices in NEW reel objects).

  So the new reels never got the hook. A base round's `preSpin` then waits in `enhancedBoard.spin`
  for a `readyToSpin` that never comes. Free spins inside the mode don't pre-spin, which is why the
  mode itself played. A page reload remounts the Board, which is why some runs looked fine.

- **Fix.** `apps/lines/src/components/Board.svelte` now installs the hook inside an `$effect` that
  follows the board, so a rebuild re-installs it on the reels it brings in. A game with no spins
  mode never rebuilds after mount, so it installs exactly the hooks it did before.
- **Gate.** `check:spins-modes` §5b runs the shipped install statement, client-compiled, over the
  real `createEnhanceBoard` and rebuilds the board 5 → 6 → 5 reels. It fails 2 of its 3 new checks
  without the fix.
- **Re-verified in the browser:** all three repros settle with money and HUD exact, and so does the
  resume control.

### Not fixed (owner or content)

- **borut-pots-sample cannot be republished as it stands.** The publish gate refuses its Flow: `exec
edge show_13.n_3n85lhy8.onBuyBonus → showContainer-22.exec has an invalid endpoint`.
  - Its `scenes.json` was saved on 2026-10-08 10:38, after the 08:43 publish, and that save removed
    the buy-bonus element `n_3n85lhy8`. The Flow (unchanged since 7 Oct) still wires it.
  - This is content drift, not code: open `/flow-v2` on the sample and reconnect or remove that edge.
  - Its boot also logs that the Flow names 4 screens the layout lacks (`s_9hrigqgj`,
    `basegameOverlays`, `s_2lm221yp`, `s_xxrfa3vs`), the same drift.
- **The playbooks are partly out of date:**
  - `borut-pots-sample.md` describes three pots (the sample has one; noted in it).
  - The `hw-*` playbooks' "Known state" says they were never played live. Both are recorded here
    and in the playbooks.

### Not bugs (recorded so nobody chases them)

- **A "mid-mode reload" is a resume only while the connection is down.** The facade drives a
  round's remaining spins and its `collect` in one burst before the presentation
  (`playOutRound`). A reload during the presentation therefore finds the round closed: the balance
  is right and the HUD win reads 0. The real resume case is a connection lost inside the burst,
  played above with `cutAfterPlays`.
- **Manual respins send all their requests up front too.** "Manual" is presentation only: the
  player presses SPIN for each respin. That is why the check is visual (`holdCheck`).
- **A coin overlay added to a Hold and Win base** (`p7c-hw-3pots`, `p7c-hw-collector`) is dealt by
  the pots-overlay mock, which takes `pot:<id>` forces. `meter:` / `trigger` / `instant` belong to
  the Hold and Win mock (the `hw-*` samples, whose pots are the preset's meters) and are refused
  here with an error envelope, as designed.

## Re-running

The plans live in `.cache/7c/plans/` (not committed). To re-run a published sample:

1. Download its snapshot and manifest entry (`scripts/current-games/lib/games.mjs`:
   `currentSnapshot`, `fetchSnapshot`, `fetchManifest`).
2. Write a plan as the driver's header describes.
3. Run `node scripts/playtest/sample-play.mjs --plan <plan> --out <dir>`.

The local launcher needs `DATABASE_URL`, `R2_*` pointed at a local S3 (virtual-host style, so a
`<bucket>.localhost` hosts entry), `EDITOR_DOC_SECRET` and `ORIGIN`, then `node scripts/start.mjs`
after `pnpm --filter launcher-api build`. The dev server cannot load the workspace's extensionless
TS packages in SSR.
