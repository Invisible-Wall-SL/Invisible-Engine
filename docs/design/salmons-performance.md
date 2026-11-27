# Salmons performance — review and plan

> Owner ask (2026-11-27): "understand why the salmon game is running slow … levels can be optimized,
> how many draw calls, are duplicated objects instantiated correctly, how we draw the level for each
> player … how is the net code, did we overdo it with information". Coordinated from one session
> that opens a work session per track below. Progress lives in [status/salmons](../status/salmons.md)
> "Performance"; this file is the plan.

## 1. What the readings say

Eleven readings of the `salmons` project (R2 `invisible_wall/salmons/perf/reports/`, 2026-11-19 →
11-26, builds `8f638a0`, `0371e35`, `c694526` — all before `665b407`).

| Device | Phase | fps | busy ms / frame | draws | passes | filter passes | RT switches |
|---|---|---|---|---|---|---|---|
| Mali-G57 (low end) | play | 29.3, p95 66 ms | render 31, JS 41 | 74 | 19 | 8.6 | 22 |
| Mali-G57 | menu | 19.7 | JS 23 | 28 | 15 | 6.4 | 17 |
| Adreno 740 (flagship) | play | 30.0 flat | ≈18 (tick 15 + late + after) | 29 | 8 | 2.9 | 10 |
| Samsung (dpr 3) | play | 30.0 flat | JS 18 | 59 | 23 | 10 | 26 |

- **Level mount:** one frame creates ~48k sprites, ~200 Graphics, ~250 meshes and uploads up to
  8 MB; a re-key destroys up to 54k; `simDroppedMs` up to 748 ms.
- **Wasted boot:** ~25 MB of ASTC textures and ~4.4 MB of the 5.2 MB download are **slot** stock
  assets Salmons never draws (reel frame, symbols, big win, reelhouse, slot audio). Boot 11.8 s on Mali.
- **Net:** in ≈23 msg/s, 6–8.5 KB/s (≈420 B per patch, ≈14 B per moving body); out ≈27 msg/s,
  ≈10 B each. After a stall up to 82 patches (58 KB) land in one frame.

## 2. Are the readings right?

Counters (draws, passes, created, uploads, socket bytes) are trustworthy. These are not:

- **fps hides headroom.** The flagship misses 60 Hz by ~1.4 ms and lands on every second vsync, so it
  reads 30.0; the desktop reads 33.3 ms with 1 ms of work (a browser / OS frame cap). There is no
  `maxFPS` in the engine. The probe computes busy time (`perfStats.ts` `busy`) but never reports it.
- **Hidden tabs are kept.** Readings `10308430` and `49aadb1f` (1004 ms frames) are a throttled
  background tab; nothing marks or refuses them.
- **`menu` mixes lobby, countdown, win screen, spectating and the level mount**, so its means are
  polluted (one 47k-sprite frame lifts the `created` mean to 770). Work counters have only mean/max.
- **Nothing names what costs** — no per-layer draws/passes, no node / culled counts, no GPU time.
- **The lab never plays an arcade game** (`lab-sequence.mjs` idles at boot), so there is no
  deterministic before/after.
- **`refreshHz` is the achieved rate**, not the display's. Spike `state` is the slot machine's.

## 3. Causes, ranked

1. **The river is ~48k loose sprites, culled by walking all of them every moved frame**
   (`salmonsArt/river.ts` `cull` 1038–1071). Each `visible` flip rebuilds the render group's
   instructions (`invalidations` = 1 every frame); the camera container is not a render group, so
   its whole subtree is re-transformed and re-packed (35k vertices a frame). Nothing is chunked,
   pooled or cached. Every client builds the river from the seed (correct — no per-player copy), but
   it is rebuilt on every `{#key}` re-mount.
2. **One filter per body:** a `ColorMatrixFilter` per underwater salmon (`looks.ts` 220–235), a
   `WadeFilter` per wading bear (`wade.ts` 206), a gold filter, plus the full-screen displacement on
   the bed at resolution 2 + MSAA. On a tiler each is a store/load of the MSAA target — most of the
   31 ms render on Mali.
3. **The quality ladder never measures arcade:** `Game.svelte` gates it on the slot machine's
   `isPlaying()`, and an arcade round never leaves `idle` (`history []`). `665b407` does not change
   that gate.
4. **Slot stock assets load for a play-field game:** `analyseStockAssets` / `stockSoundReach` have
   no family branch, and `Game.svelte` mounts the coded slot `<Background>` for arcade too.
5. **Per-frame JS:** every player's `zIndex` changes each frame, so the spawn layer re-sorts all
   trees and decks in view; a fresh canvas `Text` per score float (an upload each).
6. **Net client:** every queued patch runs a full `received()` pass and reconcile; a stall replays
   82 of them in one frame. The wire itself is lean (float32, static data sent once,
   delta-encoded input).
7. **Net scale:** a per-client `StateView` with `nearby.max` 6400×6400 filters almost nothing, so the
   per-client encode is paid for no saving; egress grows with people².
8. **Desktop loads RGBA pages** (117–144 MB GPU) by the 2026-11-12 rule that only phones take KTX2.

## 4. Tracks

Each track is its own branch, PR and session; all keep every current game building and looking the
same (rule 3 of the Director ground rules applies to engine changes too). Look-changing items wait
for the owner (§5).

| # | Track | Owner agent | Files (main) | Done when |
|---|---|---|---|---|
| T1 | **Probe accuracy** — busy p50/p95 vs budget, hidden/throttled frames excluded + reading marked, p95 per work counter, arcade `loading` / `lobby` / `play` / `spectate` phases, arcade room phase as spike state, `refreshHz` → achieved, per-layer draw / pass / node / culled sample, socket bytes per message code; launcher reads and shows them | `engine-pixi-svelte` + `launcher-studio` | `apps/lines/src/game/perf*.ts`, `arcadePerf.ts`, `PerfHud.svelte`, `pixi-svelte/glCounters.ts`, `launcher-api/src/lib/profiler*.ts` | `check-profiler*` pass; a slot reading unchanged; HUD shows busy / 16.7 ms |
| T2 | **Salmons lab run** — arcade step in `lab-sequence` joining a room with N bots, a scripted 60 s input loop, pinned seed, keep `play` counts; the before/after harness for T4–T6 | `arcade-games` | `scripts/playtest/lab-sequence.mjs`, `lab-run.mjs`, `salmons-play.mjs` | a local lab reading of Salmons with non-empty `play` |
| T3 | **Arcade boot diet + ladder** — family-aware `analyseStockAssets` / `stockSoundReach`; no coded slot `<Background>` / board for play-field and card mechanics; quality ladder `measuring` = arcade `play`, `quiet` = menu | `engine-pixi-svelte` | `stockAssets.ts`, `stockAssetRules.ts`, `stockSounds.ts`, `stockSoundRules.ts`, `Game.svelte` | slot games load the same files (fixtures); Salmons loads no slot stock; ladder history non-empty on a slow arcade run |
| T4 | **River chunks** — ground in ~8×8-cell chunk containers, culled on chunk crossing; `turn` / `upright` / `cliffs` as render groups; keep the river across rounds and re-keys, build chunks lazily; spawn layer sorts only moved bodies; displacement sprite not rendered | `arcade-games` | `salmonsArt/river.ts`, `IsoWorld.svelte`, `SpawnLayer.svelte` | pixel-identical river (`check:salmons-art`, screenshots), no 48k-sprite frame, `invalidations` ≪ 1 / frame |
| T5 | **Filters into shaders** — the salmon's under-water tint in its MeshRope shader, the bear's waterline in its own, gold likewise; no per-body filter | `arcade-games` | `salmonsArt/looks.ts`, `wade.ts`, `SpawnLayer.svelte` (gold only) | side-by-side pixel match; filter passes in play ≤ 2 |
| T6 | **Net client once per frame** — `onStateChange` records step + places only; bind / push / reconcile once per frame from the newest state; confirm input is one per fixed step (two reviews disagree) | `arcade-games` | `apps/lines/src/game/online.ts` (net half), `engine-mechanics/src/netcode.js` | `check:netcode`, `check:room-sim`, both online playtests pass; a forced stall runs one pass |

Order: T1, T2, T3 and T6 start at once (disjoint files). T4 then T5 (both in `salmonsArt`; T5 starts
after T4 merges to avoid `SpawnLayer.svelte` conflicts).

## 5. Owner decisions (not started until approved)

- **Phone defaults for arcade:** start at resolution 1.5, MSAA off when filters run, back buffer off
  when nothing needs backdrop blend. Large GPU saving; softer edges.
- **Desktop KTX2 via BC7** (`deviceClass.ts` `prefersCompressedTextures`): ~85–110 MB GPU saved,
  near-lossless; reverses the 2026-11-12 rule.
- **Quantised positions for other players** (int16 ¼ px, own player float): −30 % bytes; needs a
  versioned room so old runtimes keep working. **Approved by the owner 2026-11-27** ("go ahead
  with 16-bit positions and patchHz 15"), **built in T7**: uint16 at the finest power-of-two step
  that covers the room's field (⅛ px on a generated river, ½ px on the original's 6768 × 19728
  map), sent by view tags to a device that asks instead of a second room; old and new runtimes and
  servers mix ([realtime-multiplayer](realtime-multiplayer.md) §5 "Packed places").
- **Config values (Game Config, a person's call):** a tighter `nearby.max`; `patchHz` 15 with a
  133 ms interpolation delay. **`patchHz` 15 approved by the owner 2026-11-27, built in T7**:
  Salmons' config in code says 15 and the delay follows the rate (`interpolationDelayFor`); the live
  project takes it when its Game Config says 15 and is published (an owner step, in the T7 PR). A
  tighter `nearby.max` is still open.
- **Bake ground chunks to textures** (`cacheAsTexture`) after T4: far fewer vertices, may shift
  sub-pixels.
- **Salmons' own loading background** (found by T3): the loading / tap-to-start screen shows the
  slot sample's purple-mine background (`foregroundAnimation` mm_bg rig, 2.9 MB GPU) behind the
  loading text, because the arcade reference layout keeps the coded slot Background anchor. Give the
  arcade reference its own loading art, then the coded slot Background and mm_bg can go too.
  **Approved by the owner 2026-11-27** ("yes, give Salmons its own loading background"); built in T3,
  from Salmons' own code-drawn art.
- **WS permessage-deflate:** measure with `scripts/room-load.mjs` first.

## 6. Capture protocol (until T1 lands)

Mali-G57, Adreno 740 and one desktop; on the charger, battery saver and Chrome Energy Saver off, the
tab visible the whole time. Join, wait for the round to run, play 10 s, press **Reset**, play
90–120 s, **Send**. The same bot count every time (note it on the reading). Variants as separate
readings: default, `?particles=off`, and `?perfgpu=1` on its own (GPU wait only, never fps). Two
readings per variant. Throw away any reading with p50 near 1000 ms. Compare busy ms against
16.7 ms, not fps.
