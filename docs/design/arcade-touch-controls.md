# Arcade touch controls — a finger's gestures as data, per online character

> Status: **built 2026-11-21 (in review)**. State: [status/salmons](../status/salmons.md),
> [status/game-families](../status/game-families.md). Agent: `arcade-games`. Builds on
> [arcade-pointer-controller](arcade-pointer-controller.md).

**Owner report (2026-11-21, first play on a phone):** "The tap movement is different than the
original. The hold should make the player always go in that direction. Right now it seems to stop.
A tap click to move in that direction could also be an alternative way to move that does not
conflict, at least for the salmon. All of this should be exposed and tunable from the pipeline,
reusable between the characters."

## 1. What was wrong

Reproduced on a 390 × 844 phone window with the browser's own touch pipeline
(`scripts/playtest/salmons-touch-play.mjs --repro` on a runtime built before this change), as a
salmon, a bear and a fisherman:

- **A finger held perfectly still steered. A finger that moved was cancelled, and the player
  stopped for good.** The game's canvas had `touch-action: auto` (`pixi-svelte`
  `InitialiseApplication.svelte`, there so a slot's page scrolls under a finger). So the browser took
  a moving finger for its own pan: after two `pointermove`s it sent `pointercancel`, which the
  tracker (`pointerControl.js`) reads as the press ending. A real finger never holds still, so on a
  phone every hold stopped within a moment. Not the room, not the dead zone, not the ability's tap.
- A tap worked: it is over before the browser decides.
- The player also stops within the dead zone of the held point (72 px in Salmons). Under a camera
  that follows, the finger's point moves with the player, so that never ends a hold; where the
  camera is held (the world's edge) it does.
- A **key** pressed and lifted inside one device step (33 ms) was lost: `keyInput` read the keys
  held at the step. A finger's tap was not: taps wait in a queue.

**What the original did** (`GuiltyForever/Salmon-` 41811c2 `client/input.js`, `game.js`;
[reference/salmons-original](../reference/salmons-original.md) §3.5, §12): while a finger is down
the player heads for the point under it and stops within 1.5 tiles; lifting stops it. Its camera
has no dead zone and no world clamp and the point is mapped again every tick, so on a phone a held
finger was a heading kept for as long as it was down. A tap (lifted within 12 px, any length) is the
class's action at that point: the salmon leaps towards it, the bear swipes the way it last moved,
the fisherman casts there if it is water. It had no tap-to-move.

## 2. The fix (every online game with `arcade.online.pointer`)

- While the pointer control listens, the canvas is `touch-action: none`, put back when it stops
  (`online.ts` `listenPointer`). A slot's canvas is untouched.
- The button keys go through a latch (`touchControl.js` `createPressLatch`): a key pressed and
  lifted between two steps is that step's press.

A game with no touch scheme changes in nothing else.

## 3. The scheme

A **touch scheme** says what a finger's hold, tap and drag do. `engine-mechanics`
`touchControl.js` (plain ESM, `.d.ts`) plays it as pure functions; `online.ts` feeds it the fingers
and each fixed step.

| Field          | Default    | Meaning                                                                                                                                                                                                |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gestures`     | `hold`     | `hold`: a held finger steers. `tap`: a tap sets a heading that is kept. `both`.                                                                                                                        |
| `steer`        | `finger`   | `finger`: towards the finger. `stick`: the way the finger was dragged from where it went down (a virtual stick; its dead zone is `tapPx`).                                                             |
| `deadZone`     | the game's | Around the player, field px. A finger inside it keeps the heading; a tap inside it stops. Absent: `arcade.online.pointer.deadZone`.                                                                    |
| `tapPx`        | the game's | How far a press may move, canvas px, and still be a tap. Absent: `arcade.online.pointer.tapPx`.                                                                                                        |
| `tapMs`        | 300        | How long a press may last and still be a tap. 0: any length (the original's).                                                                                                                          |
| `releaseStops` | `true`     | Lifting a held finger stops the player. `false`: it keeps going.                                                                                                                                       |
| `ability`      | `tap`      | How the class's tap button (`pointer.taps`) is pressed: `tap` any tap; `target` a tap on a target of the ability; `secondFinger` another finger's tap while one is down; `button` an on-screen button. |
| `aim`          | `point`    | `point`: the press is aimed where tapped. `ahead`: aimed as a key press is.                                                                                                                            |
| `targetRadius` | 72         | For `ability: 'target'`: how near a target a tap must land, field px.                                                                                                                                  |

**Hold to steer.** The heading is from the player to the finger. It is never dropped on reaching
the point: once the player is within the dead zone of it the heading is kept, and it is aimed again
only when the finger has moved on by more than `tapPx`. So the player neither stops at the point
nor turns back for it where the camera does not follow.

**Tap to head.** A tap sets the heading from the player to the tapped point. It is kept until the
next tap, a hold, a tap on the player (inside the dead zone: stop), a movement key, or a wall: no
way made (under 4 px) for 500 ms while the room does not hold the player still.

**What one gesture means.** A tap can be asked to do two things (move, act). The rule is the
scheme's `ability`, chosen per class:

| `ability`      | A tap on the field                                               | The ability                                   | Fits                                             |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `tap`          | acts, aimed there; and heads there too where taps head           | every tap                                     | an act that goes where you go: the salmon's leap |
| `target`       | on a target: acts there, does not move. Elsewhere: heads, no act | a tap on a target                             | an aimed act: a cast on the water                |
| `secondFinger` | heads, no act                                                    | a second finger's tap while the first is down | acting while steering                            |
| `button`       | heads, no act                                                    | the on-screen button                          | anything; nothing on the field ever acts         |

A target is, for an aimed `hook` (Salmons' cast), the water; for any other ability, a player of its
targets drawn within `targetRadius` of the tap. While the own player holds a catch (a `hook` with a
`carry`), a tap anywhere is on target: the press throws it, and it may be thrown onto land too. The on-screen button is in the page over the
canvas (bottom right, shown once a finger has been used or on a phone or tablet, while the own
player plays), so a press on it never reaches the play field.

**The screens.** While the own player is out or no round runs, the scheme takes nothing: a finger
on the death screen's Respawn neither moves nor acts, and no tap is left waiting for when the
player is back. The start menu is in the page, over the canvas.

**More than one finger.** One finger steers. Another put down while it does is a tap in waiting:
its tap is a tap (or, under `secondFinger`, the ability), and the hold goes on, so a player may
hold with one thumb and tap with the other. It takes the steering over only by dragging (never
under `secondFinger`), and when the steering finger lifts, a finger still down steers on with no
stop.

**With the keys and the mouse.** A held movement key wins and drops a heading. The mouse is read
by the pointer block as before (hover or press); the newest device steers. Presses of one button
wait a step for the last one's release, at most two wait.

## 4. Where it lives, and reuse

`arcade.online.touch`, beside the block it refines:

```ts
arcade.online.touch = {
	schemes: { [name]: ArcadeTouchScheme }, // the project's named schemes (at most 16)
	characters: { [onlineClassId]: name }, // the scheme each class plays
};
```

- **Reuse is by name.** Two classes that name one scheme share it: edit it once and both change.
  A new scheme starts as a copy of a built-in preset (`ARCADE_TOUCH_PRESETS`: Hold to steer; Hold or
  tap to head; Tap a target to act; Move by touch, act by button; Virtual stick).
- A class with no scheme, and the mouse always, play as `arcade.online.pointer` alone says. The
  schemes do nothing while that block is absent (the validator says so).
- **Why not the state machine or the component** (the owner's suggestion, weighed): a brain's
  state machine decides for a bot and runs in the room; a touch scheme turns one person's fingers
  into an input and runs on that person's device; a component is a look. They meet at the input
  (`moveX`, `moveY`, buttons, aim), which is where the scheme stops. The thing a person plays
  online is the online class, and Salmons' three classes have no `arcade.characters` entry at all,
  so the scheme is named per class, in the card that already holds the class's tap button.
- **Carried, not normalized**, as the character sheets are: `normalizeGameConfigDoc` drops the
  block, so the slot, match-3 and card runtimes do not change by a byte. `game-config`
  `touchScheme.ts` reads it off the raw doc (`touchOf`, `touchSchemeOf`, `validateTouchSchemes`);
  the launcher's load and save put it back (`withTouchSchemes`); the arcade runtime reads the baked
  config.
- **Rule 8:** no new asset class. The block is in the Game Config, which already ships.

**Tool:** `/config`, Online, the **Mouse and touch** card: the schemes (add from a preset, rename,
duplicate, delete), one control per field, and a Touch scheme select per class beside its tap
button. `/characters`, the Online class card: the class's Touch scheme select and a link to the
editor. Guides: [game-config](../tools/game-config.md),
[invisible-characters](../tools/invisible-characters.md).

## 5. Server-authoritative, as before

The scheme only changes the input a device sends: a direction within `MOVE_SCALE`, a one-step
press, an aim, all through `clampInput`. No rule, speed or cooldown moves, the room and its schema
are untouched, bots never read it, and no recorded trace changes.

## 6. Salmons

`engine-mechanics` `salmons.js`, and `scripts/salmons/export.mjs` (which carries the block):

| Class           | Scheme | What it is                                                                                               |
| --------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| salmon          | `swim` | `gestures: both`: a hold steers; a tap leaps towards the point, as the original, and keeps heading there |
| bear, fisherman | `walk` | the defaults: a hold steers, a tap acts (the bear swipes, the fisherman casts where tapped)              |

Different from the original on purpose: a hold never stops at the point; a press longer than
300 ms lifted in place is not a tap (the original's any-length tap would leap at the end of every
still hold); the salmon's tap also sets a heading (the owner's alternative). The fisherman keeps the
original's tap-casts-there; `Tap a target to act` (a tap on land walks him) is one select away.

## 7. Gates and playtest

- `pnpm check:arcade-touch`: each gesture rule as a pure function (a hold past the point and under a
  camera that does not follow; release stops or not; a tap by length and distance; tap to head until
  a tap, a hold, a tap on itself, a key, a wall; each `ability`; the screens; the stick; a sub-step
  key), the input through the room's clamp, and the config (absent ⇒ nothing, the carry, sparse
  storage, sharing, warnings, the presets, Salmons).
- `check:game-config-family`, `check:config-character-sheets`, `check:characters-tool`: the setters,
  the carry through load and save, a doc with no block byte for byte.
- `scripts/playtest/salmons-touch-play.mjs`, both netcodes: a phone window, fingers through the
  browser's touch pipeline, the three classes ([playtest/salmons](../playtest/salmons.md)).

## 8. Not done

- A real phone has not been used. The run is Chromium's touch emulation.
- The mouse is not read by a scheme: on a desktop it behaves as before.
- The on-screen button is one fixed round button, bottom right: no side, size or art setting.
- Two fingers pinching or a swipe gesture mean nothing.
- With `ability: 'target'` and a hold gesture, a tap on a target still steers towards it for the
  length of the press (a hold starts when the finger goes down); it sets no heading.
- The on-screen button's label (Jump, Act, Act 2) is English, not a Lingui string.
- The press on a Pixi button drawn over a play field is still also a touch on the field for a class
  with NO scheme (the pointer controller's known gap); a scheme takes nothing while the player is
  out, which covers Salmons' death screen.
