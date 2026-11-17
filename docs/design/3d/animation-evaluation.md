# 3D games — character and camera animation (evaluation)

> Status: **evaluation only, nothing built.** Input to `docs/design/3d-games.md`, which the
> coordinator merges with the asset, runtime and gameplay/online evaluations. Written 2026-11-17.
> It assumes those sessions' working direction: 3D is a view mode on the arcade family, three.js
> renders it, models come from Blender as glTF, and 3D code never reaches a 2D game's bundle.

## 0. What the reference project actually gives us

The brief says BattleOTtheYear has "7 heroes with Animator controllers, Cinemachine, Timeline".
**It does not, so there is nothing to port**:

- All 7 hero prefabs (`Assets/_Project/Prefabs/Heroes/*_Prefab.prefab`) are **capsules**: a
  `MeshFilter` on Unity's built-in capsule (`fileID: 10208`), a `CharacterController`, a
  `Rigidbody`, `ClientNetworkTransform`, `PlayerController`, `Health`, `PlayerWeaponController`,
  `CarriablePiece`, `Interactor`. No `Animator`, no `SkinnedMeshRenderer`.
- `Assets/_Project/Animations/` is empty. There is no `.controller`, `.overrideController`, `.anim`,
  `.mask` or `.playable` anywhere under `Assets/`. `Health.cs` only disables "any Animator in
  children" on death, as a generic precaution.
- Cinemachine and Timeline are installed packages, but no scene, prefab or script uses them. The
  camera is **first person**: `PlayerController.OnNetworkSpawn` parents `Camera.main` to the hero's
  `CameraTarget` child, adds head bob (`HandleHeadBob`), and holds props and corpses at fixed
  points under the camera. On death, `Health.cs` detaches the camera and lets it "ghost follow".

So the clip set, the animation graph and the camera rigs have to be **designed from the gameplay**,
not converted. That gameplay is: move, sprint, jump, look, fire (per `WeaponConfig`), pick up,
carry and throw (props and corpses), take a hit, die, respawn, and get bounced. Movement is
owner-authoritative (`ClientNetworkTransform`), and the Netcode `NetworkVariable`s carry name, team,
kills and the held object.

**Owner question:** first person or third person? A first-person 3D brawler shows only arms and a
weapon (a separate "viewmodel" rig) to its own player, and full bodies to everyone else. Third
person shows one body to everyone. Everything below works for both. The choice changes the clip
list (viewmodel clips) and the default camera rig.

## 1. Where clips are authored

### Recommendation: Blender, one shared humanoid skeleton, glTF clip libraries

| Convention        | Rule                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skeleton**      | One **IE Humanoid** armature (a fixed list of bone names, a fixed rest pose and a `root` bone at the feet) is shared by every humanoid hero. Each hero is a skin on it. A non-humanoid (a beast hero) gets its own skeleton and its own clip libraries.                                                                         |
| **Files**         | `heroes/<hero>.glb` holds the mesh and skin only, with no clips. `anim/<skeleton>/<set>.glb` holds the clips: `locomotion`, `combat`, `carry`, `reactions`, `emotes`. A hero-specific move goes in `anim/<skeleton>/<hero>.glb`. A clip file carries the armature only, with no mesh.                                                  |
| **Clip names**    | The Blender action name is the glTF animation name: `<set>.<clip>`, lower snake case, for example `locomotion.run_fwd`, `combat.sword_slash_1`, `carry.idle`. The animation doc refers to clips by this name, so renaming an action is a breaking change. The Characters export validates the names.                                      |
| **Export**        | glTF exporter **Animation mode: Actions**, every action that targets the armature, sampled, with **Always sample** on. Turn on "Force keeping channels for bones", strip scale tracks (non-uniform bone scale is rejected), and export +Y up in metres. A one-click export preset, plus a small Blender script that also checks bone names, is the deliverable here.                                    |
| **Frame rate**    | Author at **30 fps**. glTF keys are in seconds, so fps only sets the sample density. 30 fps keeps the files small, and three.js interpolates between keys.                                                                                                                                                                                         |
| **Root motion**   | **In place, always.** `root` never moves, and hips translation stays in the clip. The arcade invariant "the server owns every place" means gameplay moves the body and the clip follows it, never the reverse. A lunge or a dash is gameplay displacement with a clip timed to match. The only root-motion clips are **camera moves and cinematic beats** (§4), which no player controls. |
| **Loops**         | The first and last frames of a looping clip match, and the exporter keeps both. The doc marks the clip `loop`; the clip's name does not.                                                                                                                                                                                                           |
| **Clip events**   | glTF has no animation events, and Blender pose markers do not export. Footsteps, VFX and SFX cues and the "weapon trail on/off" window are therefore authored in the **animation doc** as `{clip, at, cue}` (§3). They are presentation only and never decide a hit.                                                                     |
| **Sockets**       | Empties parented to bones (`socket_hand_r`, `socket_back`, `socket_head`) export as glTF nodes. Weapons and carried props attach to them at runtime.                                                                                                                                                                           |

**Why clip libraries, not one file per hero:** three.js binds an `AnimationClip` to a skinned mesh
**by node name**. Seven heroes on one skeleton then share one `locomotion.glb` with no
retargeting, a clip is downloaded once per game, and a new hero needs no animation work until it
gets its own moves.

**Proportions:** heroes of different height on one skeleton work as long as clips key **rotations
only**, plus hips translation. At load, the runtime scales the hips translation track by
`heroHipHeight / skeletonHipHeight`, which is about 10 lines of code. Anything beyond that, such as
a dwarf whose arm swing intersects his body, gets a hero-specific override clip.

**Retargeting between different skeletons happens offline, in Blender, never at runtime.** The
tools for it are Rokoko's free retargeting add-on and Auto-Rig Pro (paid). three.js
`SkeletonUtils.retargetClip` works, but it is fragile and costs CPU on every device for no gain.

### Bought or captured motion

| Source                                                           | Licence (verify the current text before relying on it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Use                                                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Mixamo** (Adobe)                                               | Adobe's FAQ says its characters and animations are royalty free for personal and commercial projects, games included. The terms do **not** permit redistributing the files themselves, and whether an edited animation counts as a Mixamo asset is unclear. Our clips sit on a public CDN, where anyone can fetch them. Retargeted, baked and compressed into our own libraries, they are "integrated" use, but **the owner or a lawyer should sign off** before a Mixamo-derived clip ships. Using one needs an Adobe account. Its bones are named `mixamorig:*`. | **Prototyping locomotion now.** Retarget onto IE Humanoid in Blender. Replace with hand-made clips before launch unless signed off. |
| **CMU Graphics Lab mocap**                                       | The original database allows use in commercial products, but the data may not be resold, even converted. Some FBX conversions (for example the 4TU one) are **CC BY-NC**, so take the original BVH, not a conversion.                                                                                                                                                                                                                                                                                                                                                    | Reference and cleanup material: idles, walks, reactions. Needs heavy cleanup for a stylised brawler.               |
| **AMASS** and similar research sets                              | Non-commercial.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Do not use.**                                                                                                  |
| Video-to-mocap (Rokoko Vision, Move.ai, and others) and paid packs | Per vendor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Later, case by case, as for any paid asset.                                                                     |

**Rejected:** one `.glb` per hero with every clip inside it (each hero re-downloads the same
locomotion, and an edit has to be repeated seven times); runtime retargeting; root-motion
locomotion (it fights server authority and prediction); authoring clips in a launcher tool (Blender
already does this job well, and a web dope sheet for 3D bones would be an L-sized project for a
worse result).

## 2. Runtime blending

### What three.js `AnimationMixer` gives us

- One mixer per character. Each clip becomes an `AnimationAction` with `weight`, `timeScale`,
  `loop` (`LoopOnce`, `LoopRepeat`, `LoopPingPong`) and `clampWhenFinished`. Actions emit
  `loop` and `finished` events.
- `fadeIn`, `fadeOut` and `crossFadeTo(other, s, warp)`. The action being left **keeps playing**
  under the fade, which is what a run → idle needs.
- `AnimationUtils.makeClipAdditive` and `AdditiveAnimationBlendMode`, `AnimationUtils.subclip`, and
  `action.syncWith(other)` for phase.
- Weighted accumulation per bone property. **Override weights are averaged, not layered.** When
  two override actions each have weight 1, every bone they both key ends up 50/50.

### What we write (all small, all pure apart from the adapter)

| Feature                         | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Crossfade**                   | Directly from the state machine's `blend` and `ease` (§3). Transitions default to `pauseSource: false` (the old clip keeps moving). The existing frozen-pose blend stays available per transition.                                                                                                                                                                                                                                                                                                        |
| **1D blend space** (speed)      | Already in the state machine (`SmBlend1D`): the two points bracketing the input play, weighted. **Needed change:** normalised-phase sync. Every point advances by `dt / its own duration`, so a 0.8 s walk and a 0.6 s run keep their feet together. The current blend gives every point one absolute clock.                                                                                                                                                                        |
| **2D blend space** (direction)  | New: `SmBlend2D` with points at `{x, y}`. Strafe locomotion uses local `moveX`/`moveY`, and aim offsets use yaw/pitch. Weights are **gradient-band interpolation** (the Unity "freeform directional" method), about 60 pure lines with a fixture. Points are phase-synced as in 1D.                                                                                                                                                                                              |
| **Masked layers**               | three.js has no bone masks. At load, each clip a masked layer uses is split into per-mask **sub-clips** (`clip.tracks` filtered by bone set, cached). For a layer with weight `w` and mask `M`, the base layer's `M` sub-clip plays at `1 − w` and the layer's clip at `w`. That is exact override layering on top of averaging. Masks are named bone sets in the doc (`upperBody` = spine_01 and down that chain), with each bone given in or out, no per-bone weights in v1. |
| **Additive layers**             | `makeClipAdditive` against the clip's first frame, or a named reference pose, played on an additive layer: hit flinches, breathing, aim offsets on top of anything.                                                                                                                                                                                                                                                                                                                                       |
| **Aim / look**                  | v1 uses **additive aim poses**: a 2D blend of `aim_up`/`aim_down`/`aim_left`/`aim_right` driven by `aimPitch`/`aimYaw`, plus a post-mixer **look-at** that rotates `spine_03` and `head` by the remaining angle, clamped (about 40 lines). No full IK solver.                                                                                                                                                                                                                                                         |
| **IK**                          | **None in v1.** Arenas are flat, carry poses are authored, and props attach to sockets. Two-bone foot IK on slopes is a later S item (three.js `CCDIKSolver` exists, but an analytic two-bone solver is simpler and stable).                                                                                                                                                                                                                                                                                         |
| **Ragdoll**                     | None. Death is a clip. Physics ragdolls would depend on the gameplay session's physics choice and add nothing to a stylised brawler.                                                                                                                                                                                                                                                                                                                                                                                     |
| **Cost**                        | Mixers update **once per render frame** with real `dt`, outside the fixed gameplay step. Animation is presentation, and nothing in gameplay reads a bone. Off-screen or far characters update at a reduced rate (every 2nd or 4th frame), and culled ones not at all.                                                                                                                                                                                                                                       |

**Rejected:** a third-party animation-graph runtime (none for three.js is maintained and small
enough to justify the bundle), and a hand-rolled skeletal blender in place of `AnimationMixer`.
The mixer's keyframe interpolation and property binding are solid. Only the layering on top of it
is missing.

## 3. The animation state machine

### Recommendation: reuse the component state machine, extend it

We already own a Rive-style, layered, pure state machine:
`packages/engine-layout/src/lib/stateMachine.ts` (types `ComponentStateMachine`, `SmLayer`,
`SmState`, `SmTransition`, `SmCondition` in `types.ts`). It has typed inputs (`number`, `bool`,
`trigger`), engine-fed inputs (`source`), ordered layers, `any`-state transitions, `exitTime`,
`blend` ms with an `ease`, `pauseSource`, `allowExit`, `onEnter`/`onExit` actions, cues, a 1D blend
state, a validator, and an editor UI (`EditorStateMachinePanel.svelte` on the shared
`GraphCanvas`). It is Pixi-free and only **says** what each layer plays ("clip X at t, mixing from
Y"). A three.js adapter can consume that output as directly as `ComponentTimelinePlayer` does.

Concepts we have, and where each fits:

| Existing concept                          | Role in 3D                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Component state machine**               | **The animation graph.** Its states play glTF clips instead of component timelines. A small extension adds 2D blends, phase sync, layer `mask` and `mode` (override or additive), and layer `weight` (an input).                                                                                                                 |
| **Characters' brains and controllers** (`behaviours.js`) | **Upstream: they decide gameplay**, and return velocities and actions. They never pick a clip. A bot and a player both produce the same gameplay state, and the animation graph reads that state.                                                                                                                         |
| **Flow v2**                               | **Game-level beats:** `setCharacterState`, play a camera move, play an emote or a victory pose (fire an input trigger), switch camera rigs. Flow never runs per-frame animation logic.                                                                                                                                         |
| **Symbols state machine**                 | Not relevant. It binds symbol × state to an asset, with no graph.                                                                                                                                                                                                                                                         |
| **`characterClips.ts`** (Salmons S0)      | The 2D precedent for "derive the clip from replicated state plus one-shot room events". Its rules carry over: a one-shot plays to its end, motion is held for a short time to avoid flicker, and a deadband applies to facing. The 4-way isometric facing does not carry over, because 3D faces by yaw.                                                                                                                       |

**Rejected:** a Unity Animator clone as a second graph format (two state machines, two editors,
two validators, for a model we already have); driving clips straight from Flow (per-frame, and Flow
is never inside a step); hard-coding the graph per hero in TypeScript (the owner wants it
authored).

### Doc shape

The doc is a `CharacterAnim3D` doc, one per skeleton plus overrides per hero, saved as an editor
doc and shipped by the rule-8 chain: export → `deploy/` → bake → pull → register, together with
the `.glb` clip libraries it names. Its `machine` field **is** a `ComponentStateMachine`. The new
fields are optional, so the existing normalizer and editor accept it, and 2D component docs come
back byte for byte.

```jsonc
{
	"id": "humanoid",
	"skeleton": "ie-humanoid@1",
	"clipLibraries": ["anim/humanoid/locomotion.glb", "anim/humanoid/combat.glb", "anim/humanoid/carry.glb"],
	"clips": {
		"locomotion.run_fwd": { "loop": true, "cues": [{ "at": 0.12, "cue": "sfx:step" }, { "at": 0.42, "cue": "sfx:step" }] },
		"combat.sword_slash_1": { "cues": [{ "at": 0.18, "cue": "fx:trail_on" }, { "at": 0.35, "cue": "fx:trail_off" }] }
	},
	"masks": { "upperBody": { "include": ["spine_01"], "exclude": [] } },
	"inputs": [
		{ "id": "speed", "kind": "number", "source": "character:speed" },
		{ "id": "moveX", "kind": "number", "source": "character:localMoveX" },
		{ "id": "moveY", "kind": "number", "source": "character:localMoveY" },
		{ "id": "grounded", "kind": "bool", "source": "character:grounded" },
		{ "id": "carrying", "kind": "bool", "source": "character:carrying" },
		{ "id": "aimPitch", "kind": "number", "source": "character:aimPitch" },
		{ "id": "action", "kind": "number", "source": "character:action" },
		{ "id": "attack", "kind": "trigger" }, { "id": "hit", "kind": "trigger" },
		{ "id": "jump", "kind": "trigger" }, { "id": "die", "kind": "trigger" }, { "id": "respawn", "kind": "trigger" }
	],
	"machine": {
		"layers": [
			{ "id": "base", "entry": "move", "states": [
				{ "id": "move", "timeline": "locomotion.idle", "loop": true, "blend2d": { "x": "moveX", "y": "moveY", "sync": "phase",
					"points": [{ "timeline": "locomotion.idle", "at": [0, 0] }, { "timeline": "locomotion.run_fwd", "at": [0, 1] }, { "timeline": "locomotion.strafe_l", "at": [-1, 0] } ] } },
				{ "id": "air", "timeline": "locomotion.fall", "loop": true },
				{ "id": "dead", "timeline": "reactions.death_fwd" } ],
			  "transitions": [
				{ "id": "t1", "from": "move", "to": "air", "conditions": [{ "input": "grounded", "op": "==", "value": false }], "blend": 120 },
				{ "id": "t2", "from": "*", "to": "dead", "conditions": [{ "input": "die", "op": "fired" }], "blend": 80 } ] },
			{ "id": "upper", "mask": "upperBody", "mode": "override", "weightInput": "upperWeight", "entry": "none", "states": [ "… attack combo, carry idle …" ] },
			{ "id": "flinch", "mode": "additive", "entry": "none", "states": [ "… hit reactions on the 'hit' trigger …" ] }
		]
	},
	"heroOverrides": { "barbarian": { "combat.sword_slash_1": "barbarian.axe_slash_1" } }
}
```

`heroOverrides` swaps clips per hero (the Animator Override Controller idea) without forking the
graph. `character:*` is a new value-source namespace in the registry that component inputs
already read.

### Gameplay states → inputs, and what goes online

| Gameplay state            | Animation input(s)                            | Replicated (server → device)                                                                         | Local only                                                     |
| ------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| idle / run / sprint       | `speed`, `moveX`, `moveY` (from yaw)          | position and yaw (already sent); velocity is derived from interpolated positions                     | blend weights, phase, foot sync                                |
| jump / fall / land        | `jump` trigger, `grounded`                    | `grounded` bit; a `jumped` room event (the precedent is `CHARACTER_CLIP_EVENTS`)                     | air pose choice, land clip                                     |
| attack / fire             | `attack` trigger, `action` (combo index)      | an `ability` or `attack` event with its action id; damage and hits are **server rules**              | **predicted on the own device on the press** (as `createAbilityPredictor` does); trail cues |
| hit                       | `hit` trigger, additive layer                 | the server's hit event (who, direction)                                                              | flinch clip and direction                                      |
| die / respawn             | `die`, `respawn` triggers                     | `alive` state                                                                                        | death clip, corpse pose                                        |
| carry (prop or corpse)    | `carrying` bool → upper-layer weight          | the held-object reference (BattleOTtheYear already replicates `_heldObjectRef`)                      | socket attach, carry clips                                     |
| aim                       | `aimPitch` (and `aimYaw` if a shoulder camera) | aim pitch quantised to a byte; it is already in the input `{aimX, aimY}`                             | aim poses, look-at                                             |

The rule: **replicate gameplay, never animation.** No clip names, clip times or weights travel.
Each device derives inputs from the state it already has, so two devices may differ by a few
frames of pose. That is acceptable, because hitboxes are gameplay shapes on the server and never
animated bones. Attack timing (wind-up, active window) is gameplay data in the character's
ability config, and the clip is authored to match it. A validator warns when a clip's
`fx:trail_on` cue falls outside the ability's active window.

## 4. Camera

### Recommendation: a small 3D camera director with virtual cameras (the Cinemachine model, in data)

These are **new code beside, not inside, the 2D world camera** (`engine-mechanics` `camera.js` is
2D view-rect maths). The concepts and Flow vocabulary are shared so authors see one model: follow
with a dead zone, `lookAhead`, `smoothing` as a time constant, a decaying shake on its own seeded
stream (`<seed>:camera`), and `cameraFollow` / `cameraMoveTo` / `cameraShake`.

| Piece                                  | Design                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Rigs** (virtual cameras, authored data) | `firstPerson` (a head socket, head bob as in BattleOTtheYear, plus a viewmodel layer); `follow` (third person: offset, damping per axis, look-ahead); `orbit` (pointer yaw and pitch around the target, pitch clamp, zoom range); `shoulder` (follow with a side offset and an aim-zoom FOV); `fixed` and `rail` (arena overview, spectator, menus). Each rig is `{id, kind, target, params, priority}`. |
| **Director**                           | The highest-priority active rig wins. A switch **blends** position (lerp), rotation (slerp) and FOV over the authored `blendMs` and `ease`, or cuts. A blend starts from the pose currently on screen, so a blend interrupted midway does not pop. These are the semantics of the state machine's mid-blend transition.                                                                                                              |
| **Collision**                          | A sphere-cast (or raycast) from the target pivot to the wanted camera position against the **gameplay collision geometry**, never the render meshes. The camera pulls in fast and eases back out slowly. Which query to use depends on the gameplay session's physics choice. Fallback: a raycast against low-poly collision meshes exported from Blender.                                                                             |
| **Shake**                              | Trauma-based (Perlin-style noise on rotation, with a little on position), decaying, and seeded as in 2D. `cameraShake(strength, ms)` keeps its signature.                                                                                                                                                                                                                                                 |
| **Authored moves** (intros, round ends, kill cams) | **Animated in Blender** as a camera object, exported as a glTF clip (node TRS) in `anim/cameras/<arena>.glb`. Played as a temporary top-priority "clip rig" with blend in and blend out. FOV is constant per move in v1, because glTF FOV animation needs `KHR_animation_pointer`, which three.js does not reliably load. A move can name a target-relative space ("orbit around the winner"), resolved at play time.                                       |
| **Flow nodes**                         | `cameraActivate(rig, blendMs, ease)`, `cameraPlayMove(clip, blendIn, blendOut)` (await-able, emits `finished`), `cameraShake`, `cameraFollow(target)`. Outputs: `cameraYaw` and `cameraPitch` for aim.                                                                                                                                                                                                                                                                                                  |
| **Invisible Cinematic**                | Later: a `camera3d` track kind beside the existing 2D `camera` track (`x`, `y`, `zoom`). Its strips reference camera clips with the strip blend and loop semantics the Cinematic already has, and actor strips play character clips. **Not v1.** The Cinematic editor lives in the 2D WebGL `/rigger`, and giving it a 3D viewport is a separate project.                                                                                            |

**Online:** the camera is entirely local. Only aim direction leaves the device, as input
(`aimX`/`aimY`, already in the online input frame). The server validates shots from the
replicated aim, never from the camera.

**Rejected:** extending `camera.js` into 3D (its view-rect, top-left and parallax model does not
generalise, and touching it risks 2D replays); a keyframe camera editor in the launcher for v1
(Blender's camera and graph editor are free and better); physics-driven cameras.

## 5. Authoring tools: keep the surface minimal

The reuse check (`docs/ui-inventory.md`) found these reusable pieces: §20 `GraphCanvas` (already
under the state-machine panel), §10 `SaveState`, §16 `panZoom`, §21 `SectionCard`, and the
existing `EditorStateMachinePanel.svelte`. There is no 3D viewport anywhere in the launcher.

| Lives in Blender                                                                                                                                                                       | Lives in the launcher                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modelling, the IE Humanoid armature, skinning, sockets; **every clip**; camera moves; retargeting of bought or captured motion; collision meshes. Shipped with an **IE export preset plus a check script** (bone names, clip naming, no scale keys). | **A "3D" tab in Invisible Characters**, not a new tool. Characters is already where an arcade character's look, body, brain and controller live, and it already saves through Game Config. The tab holds: the character's `.glb` and clip libraries (R2 picker), a **three.js preview stage** (lazy-loaded, launcher only), the **animation graph**, a reuse of `EditorStateMachinePanel` that takes clip names in place of timelines, **input scrubbers** (speed and direction pad, trigger buttons, `carrying` toggle) to test blends live, clip cue markers, mask pickers (a bone list), and camera-rig parameters with a preview. |

Rule 9 is satisfied by updating `docs/tools/invisible-characters.md`, with no new registry entry.
The three.js preview is the first 3D viewport in the launcher. It must come from the same package
the game uses, so preview and game cannot disagree (the lesson from "ask which surfaces are
correct").

**Rejected:** a standalone "Invisible Animator 3D" tool (a second home for character data); a web
dope sheet or curve editor for 3D (Blender's); extending `/rigger`, whose static vanilla-JS 2D
WebGL page is already 9.5k lines.

## 6. Sizing and build order

The runtime session owns the 3D chunk's isolation. Everything below lives in that lazily imported
3D package, except the state-machine type extension, which is optional fields in `engine-layout`
(no Pixi, no three.js), gated by byte-for-byte normalize fixtures for 2D docs.

| #   | Step                                                                                                                                       | Size | Depends on                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------- |
| A0  | IE Humanoid skeleton template, the Blender export preset and check script, and the conventions page; a Mixamo-retargeted prototype clip set (pending licence sign-off) | S    | the asset session's Blender setup  |
| A1  | three.js adapter: load clip libraries, bind by bone name, one `AnimationMixer` per character, crossfades driven by the state machine's output, hips-height scaling, sockets | M    | the runtime session's 3D view      |
| A2  | State-machine extension: phase-synced 1D, `SmBlend2D`, layer `mask` / `mode` / `weightInput`, masked sub-clips, additive; validator and fixture gate | M    | A1                                 |
| A3  | Gameplay → inputs: the `character:*` sources, offline from the loop, online from replicated state and room events, the predicted attack | M    | the gameplay/online session's state shape |
| A4  | Camera director: the `firstPerson`, `follow`, `orbit`, `shoulder` and `fixed` rigs, blends, collision, seeded shake, Flow nodes | M    | A1; physics query from gameplay    |
| A5  | Authored camera moves from glTF and `cameraPlayMove`                                                                                       | S    | A4                                 |
| A6  | Characters "3D" tab: preview stage, graph editing on the reused panel, scrubbers, cues, masks, camera params; rule-8 chain for `.glb` and the doc | L    | A1–A4                              |
| A7  | Aim poses and look-at                                                                                                                      | S    | A2                                 |
| —   | Later: foot IK (S), a Cinematic `camera3d` track (M), viewmodel arms if first person (S–M)                                                     |      |                                    |

**Order:** A0 → A1 → A2 and A4 in parallel → A3 → A5 and A7 → A6. A0 to A5 can be authored as
JSON with no tool, so gameplay can be playtested before A6. In total this is one **L**, driven by
A6.
