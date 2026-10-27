# commonoverlayproject — game brief

A slot with the pots overlay leading into Hold and Win; most owner reports of Oct 2026 came from
it. Owner agent: `bonus-games` for the overlay ([family](../families/bonus-games.md)); base kind's
agent not recorded.

## What it must be

- A base game whose pots fill and start a Hold and Win bonus, with a jackpots bar (Mini, Minor,
  Major, Grand, one `R_Widget` frame rig per tier) and a respin counter (a segmented counter).
- Authored cinematics: a base-game intro (`Reel_Intro`, the reels zooming in, Element FX such as
  Assemble), a Pots screen timeline, and a Hold and Win feature intro with curtains and rockets.
- Client: `invisible_wall` (asset keys in `apps/launcher-api/scripts/check-component-*.ts`).
  Purpose and end client: not recorded.

## Kind and add-ons

- Base kind: not recorded. Add-on: the pots overlay (a forced `pot:red` reaches the Hold and Win
  feature; [cinematic status](../../status/cinematic.md) 2026-10-20). Preset and pot count: not
  recorded.
- The Hold and Win respin board's own rules belong to `hold-and-win-games`
  ([family](../families/hold-and-win.md)); the overlay, routes and mode stack to `bonus-games`.

## Where it lives

- Content: `invisible_wall/commonoverlayproject/` in R2 (e.g. `spines/R_RespinTile/`,
  `manifests/atlas_manifest_S_HolographicBackdrop.json`); snapshots under `…/published/`.
- Online: published by Game Maker under the project's own key, on `runtime:lines`.
- **Desktop build `commonoverlayprojectbuild`:** since desktop launcher v1.0.58 a desktop
  ☁ Publish of an online-published project moves to `<key>build`, its card titled `<name> Build`
  ([launcher guide](../../tools/invisible-launcher.md); [launcher status](../../status/launcher.md)
  2026-10-21). On v1.0.57 the publish was refused with HTTP 409.

## How it is tested

- Playbook: none of its own. Nearest: [borut-pots-sample.md](../../playtest/borut-pots-sample.md)
  (pots overlay on a slot) and [hw-3pots-sample.md](../../playtest/hw-3pots-sample.md).
- Current games: script chosen by its kind (`scriptFor`, `scripts/current-games/lib/plan.mjs`);
  the `pots` scenario runs where the contract has `grid.potsOverlay`. No measured cost in
  `costs.json`. The desktop build is not rendered (own bundle).
- Offline gates born from its reports: `check:canvas-window-scale`,
  `check:screen-timeline-mounts`, `check:editor-instance-parity`,
  `check:component-repeat-segments`.

## State and quirks

Owner reports, 2026-10-14 → 10-25 (several fixes were still in review when recorded):
- A `canvas` screen (its feature intro) drew per window pixel, leaving reels open on a wide window.
  Fix: tick **Scale with the window** on the screen; existing screens are not ticked for you.
- A background Rect stopped at 1920×1080 on a bigger window (fixed: it now covers).
- Timelines stuck on frame 0 (9b hotfix), an intro that played twice when unticked, art drawn over
  the reels after the intro, the Pots timeline animating a second copy (all fixed, cinematic).
- A pinned `segmentedCounter` (v4) missed its segment def; a snapshot published before the end
  caps existed drew only the middle segment: republish after component edits.
- Rig FX sparks on the firecrackers did not play from a timeline strip (fixed, pots-overlay).
- Pink backdrop glow missing on some phones (KTX2 premultiply; fixed, engine 2026-10-15).
- A 3 MB console of warnings per session (fixed, engine 2026-10-25).
