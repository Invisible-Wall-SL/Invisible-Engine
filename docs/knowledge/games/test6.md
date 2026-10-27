# test6 — game brief

"Ways on Waves", the live ways slot; its desktop build is `waysofwavesbuild` (one project, two
keys). Owner agent: `ways-games` ([family](../families/ways.md)).

## What it must be

- A ways slot on a stepped 5×[3,4,4,4,4] board with an authored perspective and a cascade
  (tumble), plus a buy table (`[1,100]`: base and one 100× buy) and free spins.
- Client: `invisible_wall`. Purpose and end client: not recorded.
- Other projects borrow its art: the shared `hudReadout` def's frame is in `test6`'s `S_UI` atlas,
  and games made from the Lines template reference `invisible_wall/test6/…UI_0005_WidgetBig`
  ([editor status](../../status/editor.md) 2026-10-02). Moving or deleting that art breaks them.

## Kind and add-ons

- Kind `ways`: the Game Config `winModel` (type `ways`) decides the pay; the kind picks template,
  flow vocabulary and mock protocol. Add-ons: none recorded.

## Where it lives

- Content: `invisible_wall/test6/` in R2; snapshots under `…/published/` (`docs/INFRA.md`).
- Online: `test6`, published by Game Maker on `runtime:lines`.
- **Desktop build `waysofwavesbuild`:** a thin game repo (engine submodule), published with
  `publish-game-bundle.mjs waysofwavesbuild … --protocol ways --project test6` plus `--launcher`
  and a read token ([test-server guide](../../tools/test-server.md)). The manifest entry must carry
  `projectKey: test6`: under its game key it 401'd and dealt the default board.
- The repo's Svelte pins were fixed at rest on 2026-10-13 (`test6#1`, launcher status).

## How it is tested

- Playbook: [ways.md](../../playtest/ways.md). Route A (local mock) proves server and money only;
  **Route B** (`?runtime=1&project=test6&k=<token>`, token supplied at run time) is the real ways
  client. Match the mock grid: `WIN_MODEL=ways ROWS=3,4,4,4,4 REELS=5`.
- Current games: `test6` rendered with
  [`ways.json`](../../../scripts/current-games/screens/ways.json) (base, line-win, free-spins,
  big-wins). `waysofwavesbuild` is not rendered (own bundle).
- Gates: `pnpm check:ways`, `pnpm check:rgs` (incl. `check:stake`, `check:buy-cost`),
  `scripts/cascade-chain.fixture.mjs`, `scripts/verify-symbol-seat.mjs`.

## State and quirks

- **Owner blocker:** its free-spin intro and outro broke when the coded screens were retired (no
  intro; the outro flashes without holding). The per-project data migration awaits the owner's
  approval ([flow status](../../status/flow.md) 2026-09-28; `docs/STATUS.md`).
- A real buy on production charged $100 and entered the feature (2026-09-29, engine status).
- A symbol shadow rig layer moved ~28 px down-right after the cell-centring fix; re-tune its
  `offset` in `/symbols` if the old look was intended (engine status).
- Fixed and guarded: hold after every paying spin (no `explosion` bound), a thin line between the
  first two columns (ways family file); a turbo button greyed by the celebration lock (flow
  status 2026-09-16).
- Ships a copy of the built-in `button`: a republish changes its HUD corner when `button` changes
  (current-games 1G). Its `freeSpinCounter` is the author's.
