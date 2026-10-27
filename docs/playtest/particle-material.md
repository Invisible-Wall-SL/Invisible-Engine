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

It takes the `cg-lines` current-games stand-in, adds Invisible FX effects as `effect` nodes on the
base game, compiles the Pulse tint reference graph **made for particles** (cost 12, 1 read) and
embeds it as Publish does. Each run boots with `?ie_determinism=7&fxdebug=1`. It writes
`result.json`, `summary.txt` and a screenshot a run, prints the summary and exits 1 on a failure.
About a minute for both WebGL versions; `--calibrate` adds about four. It is not in `check:all`:
it needs a release build of the runtime first. The behaviours it plays are also held in CI by
`pnpm --filter fx-spike particle-material` and `player`.

### S1 — published: the material draws
- **Do:** one effect, `embers/main`: 120 coin particles, `material: custom:pulsetint`.
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
- **Do:** one effect with nine material layers, `swarm/m1`…`m9`.
- **Expect:** eight `on`, then `swarm/m9: plain, over the game cap`; at all five moments eight
  meshes draw and the ninth layer's sprites draw (no pop either way).

### All runs
- **Expect:** the page drew on the WebGL version asked for (WebGL1: the page is refused a `webgl2`
  context, as a WebGL1-only phone refuses it); no error, stall, console error (but Typekit's) or
  failed request.

### `--calibrate`
Times `--frames` frames of S1, S2 and S4, each run, drawn and waited on alone, and reports median,
p95, max and frames over twice the median. The headless shell renders in software (SwiftShader), so
these numbers only compare the runs with each other. Read on 2026-10-27:

| Run | Load | WebGL2 frame (median / p95) | WebGL1 frame (median / p95) |
|---|---|---|---|
| S2 plain, 83 sprites | — | 280 / 338 ms | 228 / 278 ms |
| S1 material, 76 quads | 104 M (326 % of 32 M) | 335 / 416 ms | 236 / 285 ms |
| S4 cap, 8 layers on | 252 M effect (394 % of 64 M), largest layer 33 M | 513 / 617 ms | 336 / 401 ms |

The coin frames are large (about 340 px across at their scale), so 76 of them already cover
8.7 M layer pixels: a cost-12 graph on them is three times over the 32 M layer budget.

## The owner's phone check

### Setup (a developer, once)

One project per case, each a Game Maker duplicate of one small lines game with nothing else
animated on its base game, each with its effect placed on the base game in the Scene Editor and
published:

| Project | Its effect | Measures |
|---|---|---|
| `cal-plain` | 120 coins whose material names a graph that is not shipped (delete it after placing): plain | the baseline frame time |
| `cal-light` | the same 120 coins on Pulse tint, made for particles (cost 12) | the price of the load alone |
| `cal-heavy` | the same 120 coins on a graph at the particle budget (about cost 150, 4 reads) | the price of the graph's cost |
| `cal-512` | Pulse tint, Max particles 512, frequency high enough to stay full | the mirror and the upload at the particle cap |
| `cal-swarm` | nine layers of 24 coins on Pulse tint | the cap of 8 |
| `cal-seed` | 120 coins on a graph `Seed → Random number → Colorize` (one flat colour a particle) | the seeds |
| `cal-parity` | 120 coins on a graph of the Output alone, beside `cal-plain` | how close a material is to plain sprites |

Send the owner each project's **Copy URL** (Game Maker) with `&fxdebug=1` added at the end.

### On each phone

Use at least one low-end Android, one recent Android and one iPhone; a phone that has only WebGL1,
if there is one.

1. Open the URL in the phone's own browser (Safari, Chrome), not inside another page or app.
2. Tap past the start screen and leave the game idle for 30 seconds.
3. Read the box in the top-left corner (`fxdebug · particle materials`):
   - **line 2:** `WebGL2 · <GPU> · <width>×<height> css px @<n>x`;
   - **line 3:** `frames (last 120): <median> ms median, <p95> p95, <max> max, <n> of 50 ms or
     more · <fps> fps`, renewed every 120 frames;
   - **one line per material layer:** its label, then `on`, `on, its peak <px> covered, load <L>`,
     `plain, <why>` or `plain while playing, <why>`, then `(<kind>; <n>/8 drawing)`.
4. Take a screenshot of the screen with the box. Spin five rounds and take another.
5. Turn the phone sideways and back, switch to another app for ten seconds and back, and take a
   last screenshot.

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

| Read | Cap | How |
|---|---|---|
| `cal-light` frame median − `cal-plain` frame median, ÷ its printed load | **32 M** layer load | Each M of load costs about that many ms on the phone. Set the layer budget to the load that costs about 2 ms on the weakest phone kept, and the effect budget to twice it. |
| `cal-heavy` − `cal-light`, at about the same covered px | **150 / 4** graph cost and reads | What the extra cost and reads add. If a budget graph on 120 coins costs more than the layer budget allows, lower 150 (and 4 if the reads dominate). |
| `cal-512` p95 and long frames, WebGL1 against WebGL2 | **512** particles a layer; the WebGL1 upload | Long frames only on WebGL1 point at the whole-buffer upload: upload only the live part there (a second buffer) before raising anything. Long frames on both: lower 512. |
| `cal-swarm` lines and frames | **8** layers a game | Eight `on`, one `over the game cap`, never a change mid-play. If the eight drop the phone under its refresh rate at loads under the layer budget, lower 8. |
| The load beside line 2's size | the meter's pixels | The load counts the layer's own pixels; a phone draws device pixels (the game's scale × the pixel ratio²). If two phones of one GPU print one load and differ in frames, the meter needs the device's scale. |

Write what is decided in the design's §10 and §16.6, and the as-built in the status file.
