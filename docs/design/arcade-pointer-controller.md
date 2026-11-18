# Arcade pointer controller — mouse and touch movement in online rooms

> Status: **planned and built 2026-11-17 (in review)**. State:
> [status/salmons](../status/salmons.md), [status/game-families](../status/game-families.md).
> Agent: `arcade-games`.

**Owner request (2026-11-17):** the original Salmons was a touch-screen game, and the rebuild is
missing its mouse click and touch-screen movement. Add it to the pipeline as an option an author
switches on and tunes per game, next to the keyboard, and turn it on for Salmons the way the original
did it.

## 1. What existed (investigated 2026-11-17)

- **Offline (the local loop)** already reads a pressed pointer (P10.11): `apps/lines` `arcade.ts`
  maps it into the character layer with `engine-layout` `spawnLayerPoint`, and `engine-mechanics`
  `behaviours.js` `controllerVelocity` uses it (a `pointer` controller; touch steering on a keyboard
  controller with no key held). Unchanged here.
- **Online rooms (Salmons) read the keyboard only.** `online.ts` `keyInput` sent
  `{seq, moveX, moveY, buttons, aimX: 0, aimY: 0, view}`. The wire already carries `aim`
  (`services/game-server` `schema.ts`, clamped by `online.js` `clampInput`); no rule reads it.
- Match-3's cell hit-test (`getCellAt`) is a board lattice; an arcade field has none. The arcade
  inverse is `spawnLayerPoint`.

## 2. What the original did (`GuiltyForever/Salmon-` 41811c2, read 2026-11-17)

`client/input.js` and `client/game.js` `tick`, `_getMouseFollowVelocity`, `_pointerToGrid`;
`server/index.js` `jump`, `cast`, `attack`:

- **Movement, every class:** while a finger is down, or whenever the mouse has been used last
  ("hover-to-move": no button needed), the player heads for the point under it as a unit vector,
  and stops within **1.5 tiles** of it. Lifting the finger stops it. Keys are the fallback when
  neither is active. Sent every 50 ms.
- **A tap** is a touch lifted within **12 px** of where it went down; a mouse's left press is a
  click at once. A tap or a click is the class's action: a salmon **jumps** (a climb tap at a
  waterfall's foot), a bear **attacks**, a fisherman **casts**.
- The salmon's jump and the cast went **towards the tapped point** (`jump {targetX, targetY}`,
  `cast {targetX, targetY}`); Space jumped in the last direction moved; the bear's attack always went
  in the last direction moved.
- **Multi-touch:** one touch id is tracked; a new touch takes it over, so the newest finger steers
  and lifting it stops steering even if an older finger stays down.
- The pointer was mapped through the world container's scroll and zoom and the isometric grid,
  lifted by the waterfall elevation at the pointer's column.

## 3. The controller

`engine-mechanics` `pointerControl.js` (plain ESM, with `.d.ts`), called by `online.ts`:

- `createPointerTracker({ mouse, tapPx })` takes pointer events in client px and keeps the
  steering point and the taps, exactly as §2: `mouse: 'hover'` (the original) or `'press'` (a mouse
  is a finger; the default for a new game, so a desktop player is not steered by an idle cursor);
  the newest finger steers; a cancelled touch neither taps nor steers; a lost focus forgets presses
  and the hovering mouse; at most two taps wait, so a burst of clicks is not played out late.
- `pointerMove(self, target, deadZone)` is the input's move: full tilt towards the point as whole
  numbers no longer than `MOVE_SCALE`, nothing within `deadZone` field px.

Parameters, in Game Config `arcade.online.pointer` (sparse; any object turns it on):

| Field      | Default | Meaning                                                                                 |
| ---------- | ------- | --------------------------------------------------------------------------------------- |
| `mouse`    | `press` | `hover`: the cursor steers with no button, a press is the tap; `press`: only while held |
| `deadZone` | 24      | stop within this many field px of the point (0–1000)                                    |
| `tapPx`    | 12      | a press lifted within this many client px is a tap (0–100)                              |
| `taps`     | none    | the button a tap presses, by online character id: `jump`, `ability1`, `ability2`        |

Salmons (`engine-mechanics` `salmons.js`): `mouse: 'hover'`, `deadZone: 72` (1.5 × the 48 px
cell), `taps: { salmon: 'jump', bear: 'ability1', fisherman: 'ability1' }`.

## 4. Screen to world

`online.ts` keeps the pointer in client px and maps it **every fixed step**: Pixi's
`mapPositionToPoint` to the canvas's global px, then `spawnLayerPoint(online.layer, …)`, which runs
`toLocal` through the world camera's container (scroll and shake) and `isoUnproject` on an
isometric screen. Re-mapping each step keeps a held finger steering while the camera follows, as the
original's did. The engine's river is flat on its ground plane (no waterfall lift), so the
original's elevation correction has nothing to correct.

## 5. With the keyboard

Held movement keys win: while one is held the pointer does not steer that step (the original
ignored the keys while a pointer was active; ours lets a keyboard player keep the keys with the
mouse resting on the page). Buttons OR together, so ArrowUp held with taps on the screen climbs a
waterfall. A tap is a one-step press: a step whose last input already pressed that button waits a
step, so two quick taps are two presses.

## 6. Online: server-authoritative and deterministic

The pointer becomes the input the keys already make: `moveX / moveY` (a direction), a button bit
for one step, and the tapped field point as `aim`. `clampInput` clamps all three on both sides, the
room steps them exactly as keys, and the predictor replays them, so `check:room-sim`,
`check:online-rules` and the recorded traces do not move. The server and its schema are untouched.

**Not matched (reported, not changed):** the cast does not read `aim`: a tap casts a line the way
J does (it hooks the nearest salmon on the water in reach), not towards the tapped point. The jump
reads it since 2026-11-18 (a leap towards the tap beyond half a cell; `status/salmons.md`). Aiming
the cast is a rules change in `salmonsRules.js` / `abilities.js`, an owner call.

**Known gap:** the device listens on the whole canvas, as the offline loop does, so a press on a
Pixi button drawn on the canvas (an authored HUD) is also a tap. Salmons' HUD has no buttons; the
original's UI was HTML. A game that puts buttons over its play field needs a hit test first.

## 7. Authoring and transport

- **Tool:** `/config`, the online game's **Mouse and touch** card (rule 10: its description is the
  header's tooltip): a toggle, the mouse mode, the two distances, and a tap button per online
  character. Setters in `config/onlineDoc.ts` write only what the normalizer stores.
- **Rule 8:** no new asset class. The block is part of the Game Config, which already travels
  export → `deploy/` → bake (`bakedGameConfig`) → the runtime.
- **Default off:** a config without the block normalizes and resolves without it, and the device
  attaches no pointer listener (`listenOnline` gets the canvas but listens only for a block). The
  offline loop is not touched.

## 8. Gates and playtest

- `pnpm check:arcade-pointer`: the tracker against §2 (hold, lift, tap within 12 px, drag, cancel,
  newest finger, hover, press, a touch taking over from the mouse, a lost focus); the move (dead
  zone, every direction within `MOVE_SCALE`, the room's clamp taking it as sent); screen → world
  through a scrolled, shaking camera, flat and isometric; the config (absent ⇒ off, empty ⇒
  defaults, limits, warnings, Salmons as §3).
- `check:game-config-family`: the `/config` setters. `check:room-sim`: the stage hands the canvas to
  `listenOnline` only for an online game.
- `scripts/playtest/salmons-play.mjs` page T, in both netcodes: a held finger swims the salmon to a
  waterfall's foot; lifted after a drag it stops steering; screen taps with ArrowUp held climb the
  waterfall; a hovering mouse steers it upstream.

This is an engine change: it reaches every online game with the runtime release on merge, and does
nothing in a game whose config has no `arcade.online.pointer`.
