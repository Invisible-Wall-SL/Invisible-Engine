# Arcade pointer controller — mouse and touch movement, offline and in online rooms

> Status: **draft 2026-11-17, waiting on the owner** (§7). Nothing is built. State will live in
> [status/salmons](../status/salmons.md) and [status/game-families](../status/game-families.md).
> Agent: `arcade-games`.

**Owner request (2026-11-17):** the original Salmons was a touch-screen game. The rebuild is
missing its mouse click and touch-screen movement. Add it to the pipeline as an option an author
switches on and tunes per game or character, next to the keyboard controllers, and turn it on for
Salmons the way the original did it.

## 1. What exists today (investigated 2026-11-17)

- **Offline (the local loop), pointer input already exists** (P10.11). `apps/lines` `arcade.ts`
  keeps one pressed point (`pointerdown` on the canvas, `pointermove` / `pointerup` on the window)
  and maps it into the character layer's space with `engine-layout` `spawnLayerPoint`, which runs
  Pixi's `toLocal` through the world camera's container and then `isoUnproject` on an isometric
  screen. `engine-mechanics` `behaviours.js` `controllerVelocity` reads it:
  - a `pointer` controller heads for the point on `x`, `y` or `xy` at `speed` and arrives;
  - a `topDown` / `sideScroll` controller with none of its keys held follows a pressed point
    ("touch steering"); a press above a side-view body jumps, any press flaps.

  This is **on by default** for every keyboard character, so "off by default" below means: a game
  that does not name the new block keeps exactly this.
- **Online rooms (what Salmons plays) read the keyboard only.** `apps/lines` `online.ts`
  `keyInput` turns held keys into `{seq, moveX, moveY, buttons, aimX: 0, aimY: 0, view}`. The wire
  already carries `aim` (`services/game-server` `schema.ts`; `engine-mechanics` `online.js`
  `clampInput` clamps it onto the field) but no rule reads it. Online characters have no
  `controller`: a room steps `moveX / moveY` at the character's speed (`stepPlayer`).
- **Match-3's cell hit-test** (`getCellAt`, P10.4) is the board's inverse lattice; an arcade field
  has no cells, so it is not reused. The arcade inverse is `spawnLayerPoint`.

So the gap is the online path, plus a way to author and tune what a press, a tap, a hold and a drag
do instead of the one implicit behaviour.

## 2. The controller: modes and parameters

**Pending the original (§7).** The original's client (`GuiltyForever/Salmon-` `client/game.js`)
sent `move {vx, vy}` every 50 ms and `jump {targetX, targetY}` / `cast {targetX, targetY}` with a
target point ([realtime-multiplayer §2](realtime-multiplayer.md#2-what-salmons-does-today)), which
suggests a pressed or tapped point drives movement and a tap aims an action, but not exactly how.
This session could not read that repository; the modes below are the candidates, and the build
implements the ones the original uses.

| Mode | Hold / drag | Tap | Release |
| --- | --- | --- | --- |
| `follow` | head for the finger while it is down | — | stop |
| `moveTo` | head for the finger while it is down | set a destination; keep going after release | arrive, stop |
| `stick` | a virtual stick: direction and strength from the press point to the finger | — | stop |

Parameters (sparse; defaults dropped): `mode`; `deadZone` px (stop within it of the point, so a
body does not jitter on it; `stick`: the drag below which it does not move); `stickRadius` px (full
tilt); `tap` — what a short press does: `none`, `jump`, `ability1`, `ability2`, with
`tapMs` / `tapPx` (how short and how still a press must be to be a tap) and `tapOn` (`anywhere` or
`self`, a press on the own body); `aim` (send the pressed world point as the input's `aim`).
Speed is always the character's own (`movement.maxSpeed` offline, its online speed online), so the
pointer never moves a body faster than the keyboard.

## 3. Screen to world

One function on the device, `spawnLayerPoint(layer, x, y)`: canvas px → the layer's container
(`toLocal`, which carries the world camera's scroll, zoom and shake) → `isoUnproject` on an
isometric screen. Online, the layer is the one the room's players are drawn in. The pressed
**screen** point is kept and re-mapped every fixed step, so a held finger keeps steering as the
camera follows the player. Gate: a camera at a known place, flat and isometric, maps known canvas
points onto known world points and back (`isoProject` ∘ `isoUnproject` = identity).

## 4. Multi-touch

The first pointer down steers (tracked by `pointerId`; the others do not move it). A second
finger while the first is down is a tap anywhere (the `tap` action), so a player can swim and jump
at once. Lifting the steering finger hands steering to no one until the next press. A mouse is one
pointer. `pointercancel` and `blur` release everything. **Pending §7** if the original did
otherwise.

## 5. With the keyboard

The keyboard wins for movement: any movement key held, the pointer does not steer that step (as the
offline touch steering does today). Buttons OR together (Space or a tap both jump). Both work at
once on a laptop with a touch screen.

## 6. Authoring, data and transport

- **Config:** a sparse `pointer` block on a character in Game Config
  (`packages/game-config` `arcadeCharacters.ts`; normalizer drops defaults, keeps unknown keys out,
  validator range-checks). Absent ⇒ today's behaviour, offline and online, byte for byte. An online
  game reads the own player's character's block (Salmons: salmon, bear and fisherman may differ).
- **Tool:** `/characters`, a foldable **Touch and mouse** card under Controller (rule 10: what it is
  in the header's tooltip): a toggle, the mode, its parameters with `InfoTip`s. Saved through
  `PUT /api/game-config` like every character field.
- **Rule 8:** no new asset class. The block is part of the Game Config, which already travels
  export → `deploy/` → bake (`bakedGameConfig`) → runtime.
- **Online, server-authoritative and deterministic:** the device turns the pointer into the same
  input it already sends — `moveX / moveY` quantized to `MOVE_SCALE` (a direction, never a
  position), button bits for a tap, and the world point as `aim` when `aim` is on. `clampInput`
  already clamps all three, the server steps them exactly as keys, and the predictor replays the
  same input, so `check:room-sim` and the recorded traces do not move. If the original aimed its
  jump or cast at the tapped point, a rule must read `aim`: that is a rules change in
  `salmonsRules.js` / `abilities.js` with re-recorded `fixtures/salmons-traces.json`, and is only
  done if §7 says so.
- **Pure core:** the mode logic (press, tap or hold, the move vector) is plain ESM in
  `engine-mechanics` (`pointerControl.js` + `.d.ts`), called by both `arcade.ts` and `online.ts`, so
  one gate covers both.

## 7. Open — for the owner

The original's behaviour is the spec, and this session could not read `GuiltyForever/Salmon-`
(attaching it was refused). Either grant read access to it, or answer:

1. What did holding a finger or the mouse do: swim towards the finger while held (`follow`), swim
   to the tapped point and stop there (`moveTo`), or a virtual stick (`stick`)?
2. What did a tap do: nothing, jump / climb (Space), or the character's action (swipe, cast) — and
   aimed at the tapped point or not?
3. Did a second finger do anything?

## 8. Build and gates (after §7)

Default off; on for Salmons in its config. Gates: `check:arcade-pointer` (screen → world through
the camera, flat and iso; each mode's movement; tap vs hold; multi-touch hand-off; the keyboard
winning; an absent block leaves offline and online inputs unchanged), plus the existing
`check:room-sim`, `check:online-rules`, `check:arcade-characters` unchanged and the current-games
check at 0 changed screens. Playtest: [playtest/salmons.md](../playtest/salmons.md) gains a touch
section. This is an engine change: it reaches every online game with the runtime release on merge.
