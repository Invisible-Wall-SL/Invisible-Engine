# Invisible FX — particles on paths (design + build plan)

> Owner direction 2026-11-16: particle FX that live on curves — emit from a line, spline or
> Bézier; move an emitter along one; or have particles take the path as their direction.
> Status: [status/fx](../status/fx.md) · Guide: [tools/fx](../tools/fx.md) · Parent design:
> [invisible-fx](invisible-fx.md) · Agent: `invisible-fx` (runtime: `engine-pixi-svelte`).

## 1. What the author gets

One **path** per emitter layer (a polyline, a Catmull-Rom spline or a cubic Bézier, drawn on the
`/fx` preview stage), used in any of three ways:

| Use | What happens | Where it lives in `/fx` |
|---|---|---|
| **Spawn along** | Particles are born on the curve — **evenly** spaced, at **random** points, or **sweeping** from start to end over a travel time. | Spawn shape → **Path** (a sixth spawn kind beside Point / Circle / Ring / Rectangle / Burst). |
| **Move the emitter** | The emitter's origin travels the curve (loop / ping-pong / once, eased); whatever spawn shape the layer has comes along, so a trail or a burst follows the curve. | Path section → **Move emitter** switch. |
| **Follow** | Each particle flies along the curve as its direction of travel (over its life, or at a speed), optionally **oriented to the tangent**. | Movement → a third mode, **Follow path**, beside Eased speed and Acceleration. |

Spawn along and Move emitter both say *where a particle is born*, so they are one choice
(**Emit from**: shape · along the path · shape moving along the path). Follow is independent of
both: a particle born on the path follows it from where it was born; a particle born at a moving
origin or in a circle follows a copy of the curve from its own birth point.

## 2. What exists that overlaps (and what we reuse)

| Existing | Relation |
|---|---|
| **Spawn shapes** (`spawnShape` torus / rect, `spawnBurst`; `setSpawnKind` keeps exactly one spawn-position behaviour) | Path spawn is a sixth kind under the same invariant: choosing **Path** drops `spawnShape` / `spawnBurst`. The library's own `polygonalChain` shape is NOT reused: it is straight segments only, random-only (no even / sweep), and gives no tangent. |
| **`fxForces`** (custom behaviour, `forces.ts`) | The model to copy: a custom behaviour in the config, one clamp (`readFxForces`) shared by behaviour and inspector, headless gate. Forces keep working on top of every path mode (§3.4). |
| **Movement** (`moveSpeed` / `fxSpeed` / `moveAcceleration`) | Follow replaces the movement behaviour (the same mutual exclusion the inspector already models as a mode). |
| **Library `movePath`** | A y = f(x) expression, rotated by the launch angle — cannot express a drawn curve or a tangent. Not reused. |
| **Win-coin flight trail** (`FlightLayer` → `<ParticleEmitter ownerPos ownerRotation>`) | A *coded* moving owner: the flight moves `ownerPos` along its arc each tick. Move emitter is the *authored* counterpart and composes with it (it moves `spawnPos`, the flight moves `ownerPos`; the library adds them). A trail effect with a path on it would trace the path relative to the flying coin. |
| **`RigBoneAttach` / bone placement** | A bone-placed layer's whole emitter (path included) rides the bone: the path is in emitter-local space, turned by the emitter's rotation. A path made OF bones is future work (§6). |
| **Element FX motion** (float, swing, …) | Moves an element, not particles; no overlap. A "move along a path" Element FX would reuse `engine-fx/path.ts` (§6). |

## 3. Data shape

### 3.1 It lives in the config, as one custom behaviour

```ts
// engine-fx/src/path.ts — behaviour type 'fxPath'
interface FxPathConfig {
	curve: {
		kind: 'polyline' | 'catmullRom' | 'bezier';
		points: { x: number; y: number; in?: { x: number; y: number }; out?: { x: number; y: number } }[];
		closed?: boolean;      // the last point joins the first
		tension?: number;      // Catmull-Rom only, 0..1 (0 = the classic spline, 1 = straight)
	};
	emit: 'shape' | 'along' | 'travel';   // 'shape' = the path does not decide where particles are born
	along?: {
		distribution: 'even' | 'random' | 'sweep';
		jitter?: number;               // px, random offset along the normal
		direction?: 'free' | 'tangent' | 'normal';  // the Direction knob becomes relative to the path
	};
	travel?: {                       // timing for 'sweep' and 'travel'
		duration: number;              // seconds for one pass
		repeat: 'loop' | 'pingpong' | 'once';
		ease: 'linear' | 'in' | 'out' | 'inOut';
	};
	follow?: {
		enabled: boolean;
		by: 'life' | 'speed';          // reach the end at death, or move at `speed` px/s
		speed?: number;
		speedMin?: number;             // per-particle multiplier floor, 0..1 (Scale's minMult contract)
		end: 'stop' | 'loop' | 'die';  // past the last point
		orient: boolean;               // turn the particle to the tangent every frame
	};
}
```

- **Points** are in **emitter-local px**, relative to the layer's origin (its placement offset,
  its bone). Bézier anchors carry `in` / `out` handles *relative to the anchor*; Polyline and
  Catmull-Rom ignore them, so switching the kind keeps the points and never loses handles.
- **Why a behaviour and not an `EmitterLayer.path` field:** the config is what every renderer
  already gets verbatim (the game's `<ParticleEmitter>`, `FxStage`, the Scene Editor overlay, the
  Rigger / Symbols `fxOverlay`, the bake, the Shader Graph particle preview). A behaviour makes all
  six play it with no new wiring, and the **exposed parameters** grammar drives it for free
  (`behavior:fxPath.travel.duration`, `behavior:fxPath.curve.points.2.x`).
- **Off by default, byte-identical:** a layer without a path carries no `fxPath` entry, so every
  existing effect, bake key and cost estimate is unchanged. Removing the last use of the path
  removes the behaviour.
- `readFxPath(config)` is the **one clamp** (finite numbers, 2 to 256 points — `FX_PATH_MAX_POINTS`,
  the rest dropped, since `init` rebuilds the table on every re-fire — known enums, duration > 0),
  read by the behaviour and the inspector alike, as `readFxForces` is. Step 3's points table stops
  adding at the cap.

### 3.2 The curve math (`engine-fx/src/path.ts`, pure)

Each curve kind flattens to segments; an **arc-length table** (built once per behaviour instance,
~8–16 samples per segment) maps a distance `s ∈ [0, L]` to a point and a tangent in O(log n).
Everything the runtime asks of a path is `pointAt(s)` / `tangentAt(s)` / `length`, so *even*
spacing is even in distance (not in curve parameter) and *follow by speed* moves at a true px/s.
Catmull-Rom is evaluated as a cardinal spline through every point (with `closed` wrapping the end
tangents); Bézier is the standard cubic per anchor pair (`p0, p0.out, p1.in, p1`).

### 3.3 How each mode runs (the behaviour, order 1)

The library sorts behaviours by `order`; only order 0 (Spawn) runs before it places the particle
at the emitter. `fxPath` uses **order 1**: after placement (so it composes with any spawn shape,
whatever the config's order) and before the Normal-order Direction / movement inits (so the launch
direction can be made relative to the path).

- **Along:** at init, `position += R·pointAt(s)` where `R` is the emitter's rotation and `s` is
  `i/(n−1)·L` (even — the n-th particle of a wave, or a running counter for a steady stream),
  `random·L`, or `ease(clock)·L` (sweep). With `direction: tangent|normal`, `rotation +=` the
  tangent angle (+90° for normal) so the Direction knob reads "relative to the path".
- **Travel:** the emitter's **`spawnPos` is shifted** by `R·pointAt(ease(clock)·L)` before each
  update, remembering what it added so an authored `pos` or a `pos.x` parameter keeps working.
  The library's own in-frame lerp then spreads a frame's spawns along the move, and force centres
  (`ownerPos + spawnPos`) travel with it.
- **Follow:** at init the particle stores its start distance (its spawn `s`, else 0 — and a
  particle not born on the path is shifted by `R·pointAt(0)` so it traces the drawn curve) and its
  birth rotation. Each update moves it by the **difference** `R·(pointAt(s₁) − pointAt(s₀))`, so
  displacement from forces is never overwritten. `orient` sets `rotation` to the tangent angle;
  the Sprite section's art offset still applies (it lives on `skew`).

### 3.4 The clock, Turbo and restarts

Sweep and Travel need the emitter's own time, which the library does not expose to behaviours.
`registerFxBehaviors(Emitter)` (already called by every renderer) installs a small **tick hook**
around `Emitter.prototype.update`: before the original update it calls `tickEmitter(emitter, dt)`
on any behaviour that has one. The clock is stored **on the emitter** (not the behaviour), so an
exposed parameter that rebuilds `fxPath` mid-flight does not restart the pass.

- **Turbo:** the clock advances by the `dt` the renderer passes to `update`, which is already
  multiplied by the particle clock — a path pass runs twice as fast in turbo, as everything else
  does. The tools preview at 1×.
- **Restarts:** the clock resets when emission switches back on (an event trigger re-firing), so
  a `once` sweep replays from the start each time Flow fires the cue. A burst (`emitNow`) uses the
  current clock.
- **Bake:** the bake steps `update(dt)` deterministically, so a path bakes like anything else; a
  looping travel should divide the bake loop for a seamless loop (the bake bar's existing seam
  check judges it).

### 3.5 Forces and movement together

- Forces stay additive in every mode (they integrate their own velocity when no velocity-owning
  movement is present, which is the Follow case).
- Follow is a **movement mode**: picking it drops `moveSpeed` / `fxSpeed` / `moveAcceleration`;
  picking another drops `follow` (and the whole behaviour if nothing else uses the path).
- Orient overrides spin: a `rotation` behaviour's speed is applied after Follow sets the tangent,
  so it only offsets each frame instead of accumulating.

## 4. Authoring in `/fx`

- A foldable **Path** card (house rule 10: what it is goes in the header tooltip) appears when the
  layer uses the path anywhere: curve kind (Line / Spline / Bézier), Closed, Tension, a points
  table (x, y, and the two handles for Bézier, ⊕ add after / bin), and the **Travel** timing row
  (duration, repeat, ease) when sweep or travel is on.
- **Spawn shape → Path** shows Distribution (Even / Random / Sweep), Jitter, Direction
  (Free / Along / Out of the path), and **Move emitter** (the `travel` choice).
- **Movement → Follow path**: by Life / Speed (+ min), At the end (Stop / Loop / Die), Orient.
- **On the preview stage**, with the layer selected and the Path card open: the curve is drawn
  over the particles; points are dots, Bézier handles are smaller dots on lines; drag to move,
  double-click the curve to insert a point, Alt-click (or the bin in the table) to delete; Shift
  snaps to 15° from the previous point. Pan / zoom stay on the background. A drag previews live (the
  behaviour is swapped, no reset) and writes the doc on release, so Save sees it as any other edit.
- Presets (*Ribbon*, *Comet*, *River*) were left out of the first build: the existing presets plus
  a path cover them in two clicks. Add them if authors ask.

## 5. How the shipped game plays it

Nothing new travels: the path is part of `layer.config`, which already ships through export →
`deploy/effects/` → bake → pull → `bakedEffects()`; there is no new R2 asset class (rule 8 is
satisfied by the existing chain). The game's `<ParticleEmitter>` calls `registerFxBehaviors`,
which registers `fxPath` and installs the tick hook. A **material** layer draws through its
material as before — the material renderer mirrors particle positions after `update`, and path
behaviours only move particles, so a 3D coin spawned on or following a path draws as a 3D coin.
The cost estimate counts `fxPath` as a cheap per-particle behaviour (one table lookup).

## 6. Sources other than the drawn curve (future, not in this build)

- **Scene Editor (placed effect node):** the curve is effect-local, so a placement can already
  move / turn / scale it. A per-placement curve comes free once the path's points are exposed
  parameters (`behavior:fxPath.curve.points.N.x`), and a later "Edit path on stage" in the Scene
  Editor would write those per-node values.
- **Rig bones:** a path whose points ARE bones (each point = a bone's world position, read every
  tick) — the `RigBoneAttach` transform feed, but per point. Needs a `points[i].bone` field and a
  per-tick re-flatten; worth it for a whip or a tail.
- **Flow target:** "fly from here to the meter" is what the coin flight already does in code. An
  authored version would bind the last point to a Flow-supplied position (a `pathEnd` parameter)
  — the natural next step after bone points.
- **Element FX:** a "Move along path" motion kind would reuse `path.ts` unchanged.

## 7. Build plan (one PR each, merged when green)

1. **This design.** (docs)
2. **Runtime** — `engine-fx/path.ts` (curves + arc length), the `fxPath` behaviour (along /
   travel / follow), `readFxPath`, the tick hook, registered with the other FX behaviours; a
   headless gate `check:fx-path` (byte-identical without a path, even spacing in distance, sweep
   and travel timing, Turbo via the particle clock, forces stacking on Follow, a parameter rebuild
   keeping the clock). A runtime release to every online game on merge (no effect changes, none
   carries `fxPath` yet).
3. **`/fx` authoring** — model helpers in `fxModel.client.ts` (spawn kind Path, movement Follow,
   the Path card), the stage overlay for points and handles, presets; `docs/tools/fx.md`.
