# Playtest — particle materials (the phone check)

Particle materials (Invisible Shader Graph step 8d, [design](../design/shader-graph-particles.md))
draw an [Invisible FX](../tools/fx.md) sprite layer through a Shader Graph effect. Their budgets
(§10) are starting values: **150 / 4** graph cost and reads, **512** particles a layer, **32 M**
layer load and **64 M** effect load, **8** material layers drawing at once in a game. Step 8d.8
sets them from real phones. This playbook has two parts:

- **The headless play** (a developer, by hand): a published stand-in game with material layers,
  played in headless Chromium on WebGL2 and WebGL1. It proves the material plays in a game and
  records the figures a desktop's software renderer gives.
- **The owner's phone check** (the owner, on real phones): the same game kind opened with
  `?fxdebug=1`, whose numbers are read off the screen and sent back. This is the step's Owner
  pass; nobody else can do it.

Status: [status/shader-graph](../status/shader-graph.md) (8d.8, open items).

## The headless play

- **Launch:** no preview; `scripts/playtest/particle-material-play.mjs` over the headless shell.
- **RGS:** the real Invisible Test Server (`services/test-server`), seed 7; the outcome does not
  matter, the board idles.
- **Build:** a release build of `apps/lines`, as the current-games harness builds it. Without the
  release env the game asks the test server over `https` and fails to sign in; the script names
  that.

```
pnpm --filter 'lines^...' build
PUBLIC_RGS_TRANSPORT=play4fun PUBLIC_DELIVERY_PROFILES='*' pnpm --filter lines build
node --experimental-strip-types --import ./scripts/ts-loader.mjs \
  scripts/playtest/particle-material-play.mjs --runtime apps/lines/build --out .cache/material-play \
  [--gl 1|2|both] [--calibrate] [--frames 120]
```

It takes the `cg-lines` current-games stand-in, adds the phone check's calibration effects
(`scripts/playtest/particle-calibration.mjs`, below) as `effect` nodes on the base game, compiles
their graphs (`engine-shadergraph`'s `CALIBRATION_GRAPHS`, made for particles) and embeds them as
Publish does. Each run boots with `?ie_determinism=7&fxdebug=1`. It writes
`result.json`, `summary.txt` and a screenshot a run, prints the summary and exits 1 on a failure.
About a minute for both WebGL versions; `--calibrate` takes about ten. It is not in `check:all`:
it needs a release build of the runtime first. The behaviours it plays are also held in CI by
`pnpm --filter fx-spike particle-material` and `player`.

### S1 — published: the material draws
- **Do:** `cal-light`'s effect, `embers/main`: 120 coin particles, `material: custom:callight`
  (Pulse tint, cost 12, 1 read).
- **Expect:** the material's mesh on the stage and drawing at five moments a second apart, its
  sprites hidden; the line `embers/main: on`; a later line with the peak and load, where load =
  covered px × the graph's cost; the on-page readout (below) with the GPU, frame times and the
  layer. No layer turns plain while playing.

### S2 — unregistered: plain, never invisible
- **Do:** the same snapshot without its `shaderEffects`.
- **Expect:** no mesh; the particle sprites draw; `embers/main: plain, not registered`. S1's
  screenshot differs from S2's, and S2's from S3's.

### S3 — none
- **Do:** the snapshot without the effect node.
- **Expect:** no particles and no readout.

### S4 — the cap of 8
- **Do:** `cal-swarm`'s effect, nine material layers, `swarm/m1`…`m9`.
- **Expect:** eight `on`, then `swarm/m9: plain, over the game cap`; at all five moments eight
  meshes draw and the ninth layer's sprites draw (no pop either way).

### All runs
- **Expect:** the page drew on the WebGL version asked for (WebGL1: the page is refused a `webgl2`
  context, as a WebGL1-only phone refuses it); no error, stall, console error (but Typekit's) or
  failed request: a `fetch` refused or answered with an error status, but the boot splash's index
  (`_boot/boot.json`), which a project with no splash answers with 404. Requests the page makes
  other than by `fetch` (images, scripts) are not watched.

### `--calibrate`
Adds two runs, `budget` (`cal-budget`'s effect) and `full` (`cal-512`'s), each held to be on and
drawing with its load, and times `--frames` frames of every run but S3, each run, drawn and waited
on alone, reporting median, p95, max and frames over twice the median. The headless shell renders
in software (SwiftShader), so these numbers only compare the runs with each other. Read on
2026-10-27:

| Run | Load | WebGL2 frame (median / p95) | WebGL1 frame (median / p95) |
|---|---|---|---|
| S2 plain, 83 sprites | — | 341 / 485 ms | 221 / 280 ms |
| S1 `cal-light`, 76 quads | 104 M (326 % of 32 M) | 332 / 449 ms | 237 / 289 ms |
| `budget`, 76 quads | 1,252 M (cost 144) | 559 / 659 ms | 428 / 503 ms |
| `full`, 510 quads | 629 M | 1,023 / 1,222 ms | 893 / 1,301 ms |
| S4 cap, 8 layers on | 252 M effect (394 % of 64 M), largest layer 33 M | 521 / 623 ms | 331 / 379 ms |

The coin frames are large (about 340 px across at their scale), so 76 of them already cover
8.7 M layer pixels: a cost-12 graph on them is three times over the 32 M layer budget. On the
software renderer the cost-12 material is lost in the noise against plain sprites; the budget
graph adds about 60 % to a frame, and 512 particles three to four times.

## The owner's phone check

### Setup (a developer, once)

Every project's graphs and effect come from one script, so each phone and each headless run
compares the same things. The graphs are `CALIBRATION_GRAPHS` (`engine-shadergraph`, held to their
cost by `compile.fixture.ts` and compiled on WebGL1 and WebGL2 by `shader-compile`):

| Project | Its effect | Graph (cost / reads) | Measures |
|---|---|---|---|
| `cal-plain` | `embers`: 120 coins | `custom:calmissing`, not shipped: plain | the baseline frame time |
| `cal-light` | `embers` | `callight`, Pulse tint (12 / 1) | the price of the pixels alone |
| `cal-budget` | `embers` | `calbudget`, fbm, noise and three offset reads (144 / 4) | the price of a graph at the budget |
| `cal-512` | `embers` at Max particles 512, lifetime 2–3 s, every 4 ms | `callight` | the mirror and the upload at the particle cap |
| `cal-swarm` | `swarm`: nine layers of 24 coins | `callight` | the cap of 8 |
| `cal-seed` | `embers` | `calseed`, Seed → Random number → Hue shift (21 / 1) | the seeds |
| `cal-parity` | `embers` | `calparity`, the Output alone (1 / 1) | how close a material is to plain sprites |

1. Write the files, naming an art key every project has (the same for all; the play uses `coins`):
   ```
   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
     scripts/playtest/particle-calibration.mjs --out .cache/calibration --art <assetKey>
   ```
   Each `.cache/calibration/<project>/` holds `shaders/<graph>.json` and `<effect>.fx.json`, as
   `/shaders` and `/fx` store them.
2. In Game Maker, duplicate one small lines game seven times, as the projects above, with nothing
   else animated on the base game.
3. Upload each folder's files into its project's root (`<client>/<project>/`, keeping `shaders/`)
   with [Invisible FTP Browser](../tools/ftp-browser.md), in an admin's full view.
4. In each project's Scene Editor, place its effect (Library → **Effects**) on the base game, in the
   middle of the board. Publish. `cal-plain`'s Publish names `custom:calmissing` as missing: that is
   its point.
5. Send the owner each project's **Copy URL** (Game Maker) with `&fxdebug=1` added at the end.

### On each phone

Use at least one low-end Android, one recent Android and one iPhone; a phone that has only WebGL1,
if there is one.

1. Open the URL in the phone's own browser (Safari, Chrome), not inside another page or app.
2. Tap past the start screen and leave the game idle for 30 seconds.
3. Read the box in the top-left corner:
   - **line 1:** `fxdebug · particle materials · <width>×<height> css px @<n>x`, the page's size
     now (it follows a turned phone);
   - **line 2:** `frames (last 120, gaps over 1 s left out): <median> ms median, <p95> p95, <max>
     max, <n> of 50 ms or more · <fps> fps`, renewed every 120 frames. A gap over a second is the
     page hidden or paused (another app in front), not a frame, so it is left out;
   - **`app 1 · WebGL2 · <GPU>`**, then one line per material layer: its label, then `on`, `on, its
     peak <px> covered, load <L>`, `plain, <why>` or `plain while playing, <why>`, then `(<kind>;
     <n>/8 drawing)`.
4. Take a screenshot of the screen with the box. Spin five rounds and take another.
5. Turn the phone sideways and back, switch to another app for ten seconds and back, and take a
   last screenshot once line 2 has renewed.

### What to send back

For each phone: its model, OS version and browser, and the screenshots for each project. Then a
line on each of these, as seen (human-eyes):

1. **Seeds** (`cal-seed`): do the particles show many different colours, or few, banded or
   repeating ones? The seed is a whole number 0…97 run through a hash, which a phone's
   lower-precision GPU maths may bunch.
2. **WebGL1** (`cal-512`, on a WebGL1 phone): any stutter or long frames that a WebGL2 phone does
   not show? WebGL1 uploads the layer's whole particle buffer every frame.
3. **Parity** (`cal-parity` beside `cal-plain`): do the particles look the same: edges, soft
   fringes, no shimmer or seams? The gate's tolerance is the desktop software renderer's.
4. **Event layers** (any game with a material layer that fires on an event): at idle, before it
   fires, does its line already say `on` and count in `<n>/8 drawing`? A dormant layer holds its
   slot from mount; say whether that kept another effect plain.
5. **Spawn order** (a material reading Particle → Spawn order on an event layer): each firing
   starts the order at 0 again, so every burst looks the same. Is that right?
6. **Anything that pops**: a layer switching between material and plain while you watch, a flash
   after switching apps, particles vanishing. Any `plain while playing` line, with its reason
   (`program does not link` means this phone's driver refused the graph).

### How the numbers set the caps (a developer)

The frame clock is the screen's: a phone that keeps up shows its refresh interval (16.7 ms at
60 Hz) whatever it draws, so `cal-light` and `cal-plain` both reading 16.7 ms says only that both
fit in a frame, not that the material costs nothing. Compare fps and the frames of 50 ms or more,
not the medians, and read the price only from a project that drops the phone below its refresh
rate: `cal-budget`, `cal-512` or `cal-swarm` push it there.

| Read | Cap | How |
|---|---|---|
| `cal-budget`'s fps and long frames against `cal-plain`'s, and its printed load | **32 M** layer load, **64 M** effect load | If `cal-budget` holds the refresh rate on the weakest phone kept, its load is affordable: the layer budget can stand (or rise toward that load). If it drops, the budget is below its load: lower it toward the load of the heaviest project that held the rate. The effect budget stays twice the layer's. |
| `cal-budget` against `cal-light` (one covered px, cost 144 / 4 against 12 / 1) | **150 / 4** graph cost and reads | `cal-light` holding the rate where `cal-budget` drops puts the price in the graph, not the pixels: lower 150 (and 4 if a reads-heavy graph is the one that drops). |
| `cal-512`'s p95 and long frames, WebGL1 against WebGL2 | **512** particles a layer; the WebGL1 upload | Long frames only on WebGL1 point at the whole-buffer upload: upload only the live part there (a second buffer) before raising anything. Long frames on both: lower 512. |
| `cal-swarm`'s lines and frames | **8** layers a game | Eight `on`, one `over the game cap`, never a change mid-play. If the eight drop the phone below its refresh rate at loads under the layer budget, lower 8. |
| The load beside line 1's size | the meter's pixels | The load counts the layer's own pixels; a phone draws device pixels (the game's scale × the pixel ratio²). If two phones of one GPU print one load and differ in frames, the meter needs the device's scale. |

Write what is decided in the design's §10 and §16.6, and the as-built in the status file.
