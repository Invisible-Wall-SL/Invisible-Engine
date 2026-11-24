# Character pipeline — one place to author a game character

> Status: **PLAN** (2026-11-20, written against `main` c1b606a8a); **C0 to C2b and C6a are
> merged; C6b is built and in review** (2026-11-20). The owner said to start
> (decision #1); decisions #2, #3, #4, #6 and #10 were built on the recommendation, #5 and #7 to #9 are open (§7). Owner tool: Invisible Characters
> (`/characters`, agent `arcade-games`). Other
> builders: `invisible-flipbook`, `invisible-rigger`, `games-3d`, `invisible-game-config`,
> `invisible-flow`, `docs-keeper`. Progress will live in
> [status/game-families](../status/game-families.md), the Characters tool's status file. Related:
> [game-families §4.3](game-families.md) (what a character is),
> [realtime-multiplayer](realtime-multiplayer.md) (the server owns the game),
> [3d-games](3d-games.md) (its §6 Phase 4 plans a 3D tab in this tool), [rig-2p5d](rig-2p5d.md),
> [live-assets](live-assets.md) (the ship chain).
>
> The ten-minute read is In short, §1 (today), §6 (the steps) and §7 (the decisions). §2 to §5 are
> the design. §8 and §9 are what every step must keep. §10 and §11 are its limits. §12 is
> reference for whoever builds a step.

**Owner request (2026-11-20):** "where do I find this assets to author now in the pipeline? is it
only the atlas? how can I control animations? frames? if it is a flipbook or a spine? I want to
have a place where I can control all of this, if the character is animated as a side view, as an
isometric 4 direction an iso [8] direction, full 3D and so on, I think this is very important for
the 3C of the character and how complex we can make it, where we can control jumps, attacks, pick
up, and anything a character could do. right now we have this only for Salmons, but we need to
think it as a production pipeline for future projects".

"3C" is character, camera, controls. "Spine" is skeletal animation: ours is Invisible Rigger and
`engine-rig`.

## In short

1. A character becomes one **sheet** in Invisible Characters: its view, its animation source, its
   actions, its draw box and attach points, then the body, movement, controller, brain and
   abilities the tool already has.
2. The sheet is stored **in the game config**, on the character's `arcade.characters` entry. An
   online class (`arcade.online.characters`) **names its sheet** and keeps only what the room
   steps with.
3. **Actions are data**: a table of rows (idle, walk, jump, attack, pick up, anything), each with
   what starts it, how it plays and its animation per facing.
4. **One resolver** picks the action and the facing for every character, offline, online and 3D.
   A small adapter per source turns the answer into a clip, a rig animation or the 3D graph's
   inputs.
5. **Gameplay timing belongs to the rules** (the server's, online). The art carries markers only.
   The tool draws both on one strip and flags where they disagree.
6. Flipbook, the Rigger and the Model Viewer stay the makers. Characters is where a character is
   assembled: it links into them and copies none of their editors.
7. **Nothing changes for a game until its character has a sheet.** Salmons is the first project
   moved, proven clip for clip before it is switched.
8. Ten steps (§6). The first two change no game and no stored data.

## 1. Today's map

Where each part of a character is made today. The guides hold the detail.

| Part | Made in | Stored as | Guide |
|---|---|---|---|
| Drawn frames | Atlas Maker, Sheet Maker | sheets | [atlas-maker](../tools/atlas-maker.md), [sheet-maker](../tools/sheet-maker.md) |
| Frame animations | Invisible Flipbook, Clips mode | clips | [flipbook](../tools/flipbook.md) |
| A character's clips per facing | Flipbook, Characters mode (`/flipbook?mode=characters`) | clips named `<prefix>_<state>_<facing>` | [Characters mode](../tools/flipbook.md#characters-mode--a-characters-whole-set-of-clips), [the Salmons sprite guide](../guides/salmons-character-sprites.md) |
| Which clips an online character plays | **no tool**: a developer writes the block; Flipbook sets only its Facings | the look component's `characterClips`; Salmons' built-in table | [status/flipbook](../status/flipbook.md) open item 7 |
| Skeletal animation | Invisible Rigger | `.irig` | [rigger](../tools/rigger.md) |
| The look: which timeline plays when | Component Editor | the component (timelines, a state machine) | [component-editor](../tools/component-editor.md) |
| Body, movement, jump, controller, brain, anim inputs, offline abilities, zone forces | Invisible Characters | `arcade.bodies`, `.characters`, `.abilities`, `.forces` | [invisible-characters](../tools/invisible-characters.md) |
| Online class (speed, places, spawns), online abilities (reach, hold, cooldown) | Game Config, Online | `arcade.online.characters`, `arcade.online.rules.abilities` | [game-config](../tools/game-config.md) |
| 3D model and its quality tiers | Blender, then Invisible Model Viewer (`/models`) | the `models` asset class | [models](../tools/models.md), [Blender conventions](../conventions/blender-3d-assets.md) |
| A 3D character's model, clip libraries, sockets, animation graph | **no tool**: hand-written JSON | `arcade.world3d.looks`, `arcade.world3d.anim` | [status/3d](../status/3d.md) |

Three separate systems decide which animation plays (§12.1):

- **Offline 2D:** anim inputs drive the look component's state machine. Two directions.
- **Online 2D:** clips found by name. 4 or 8 directions. Three loops and four room events.
- **3D:** an animation graph fed a fixed set of inputs and triggers. The camera gives direction.

**The gaps:**

1. No tool edits what an online character or a 3D character plays.
2. The action list is closed. The state names are data, but the slots are code: three loops and
   four events, both attack buttons sharing the one `ability` event. Nothing can add "pick up".
3. Three systems, three direction rules. Only an online frame-clip character has 4 or 8 facings.
   An offline one has two. A rig has none.
4. The view is never chosen. It is implied by the screen's `projection`, the controller kind, the
   jump kind, `characterClips.facings`, `arcade.online.keys` and the presence of `arcade.world3d`.
5. The rules time an ability (hold, cooldown) and the art knows nothing of it. There is no
   wind-up, no lock, no marker on a clip, and nothing compares the two.
6. Characters previews placeholder shapes. Only Flipbook's Directions card shows a character in
   its art.

## 2. The character sheet

**Stored in the game config**, on the character's `arcade.characters` entry (decision #2; the
other options are in §12.2). Characters already saves there, under Game Config's lease, with
History. The config already ships, so there is no new asset class. The game server can read it. A
3D look is already in it.

**Carried, not normalized.** `game-config` is in every runtime's bundle, and the slot, match-3 and
card bundles keep its arcade normalizer and validator. So neither learns the sheet:
`normalizeGameConfigDoc` drops the fields, as it drops `arcade.world3d`, and whoever needs a sheet
reads it off the raw config with `game-config` `characterSheet.ts`. The launcher's load and save
put the fields back on the normalized doc (§9, Bytes).

**One definition; an online class refers to it.** `arcade.online.characters[].sheet` names an
`arcade.characters` id, and both must use the same component. A class with no `sheet` plays as
today. The two entries are not merged: the room's block is bounded and read by the server, with
committed traces recorded against it, and offline movement (`motion.js`) and online movement
(`stepPlayer`) are two models whose numbers cannot be folded together without moving a replay.
Bots are unchanged. A 3D look stays at `arcade.world3d.looks.<id>`, under the same id, and the
sheet edits it there.

**What a sheet holds:**

| Part | Holds | Detail |
|---|---|---|
| View | Side, Top-down (4 or 8), Isometric (4 or 8) or 3D, chosen once per character (decision #3). It fixes the facing list and rule. The tool offers the controllers and jumps that fit; the validator warns when the screen disagrees | §12.3 |
| Animation source | The component's own state machine (today's offline look, and the default), frame clips, still images, a rig, or a 3D model | §12.4 |
| Actions | One row per thing it can do: what starts it; loop, once or hold; priority; what may interrupt it; its animation per facing; the action that stands in when it has none; markers | §12.5 |
| Draw | Width, where the feet are, named attach points (Salmons' `hand`), variants (the golden salmon) | §12.7 |
| Body, movement, controller, jump, brain, abilities, zone forces | As today | [the guide](../tools/invisible-characters.md) |

**What starts an action** (§12.6): a movement state found by itself (still, moving, rising,
falling, landed, on a wall, hopping); an ability button; a rules event that names the character; a
status that holds (stunned, hooked, holding a line, carrying); a brain state (offline only: a bot's
brain state stays on the server); a Flow node.

**Actions become data. Rules do not.** A second attack needs no code: `ability2` gets its own
row. A "pick up" that changes the game still needs a rule that exists: offline a collision pair
and Flow; online an ability effect or a rules module, which is `engine-mechanics` code. The sheet
decides what is drawn when the rule fires.

**What an action blocks is not on the action.** Blocking movement or another ability changes the
game, so it is a rule on the ability (§4).

## 3. One resolver

Three stages, the same for every character:

1. **Action.** From the triggers that hold this frame and the one-shot in hand: one action.
2. **Facing.** From the drawn velocity through the screen's projection, with the dead band and the
   turn hold `characterClips.ts` has today: one facing of the view's list. 3D skips this stage.
3. **Adapter**, one per source: the action and the facing become what is drawn.

How each source answers "direction":

| Source | Answer |
|---|---|
| Frame clips | A clip per drawn facing. A mirrored facing draws its twin's clip flipped. A missing one is stood in for by the nearest facing, then by the action's fallback (today's order) |
| Still image | One frame of a project sheet in a cell, in place of a clip: drawn, mirrored and stood in for as a clip is. A character whose every action falls back to one still is one image |
| Rig, one rig | The animation named for the action (`walk`) in every facing, flipped in the facings that look west (`w`, `sw`, `nw`). Fits a side view |
| Rig, per facing | A rig per drawn facing (front and back), or one rig with an animation per facing (`walk_se`). Mirrored and stood in for as clips are |
| Rig, 2.5D ([rig-2p5d](rig-2p5d.md)) | The game sees "per facing": the Rigger would bake one ordinary animation per facing from the 3D pose. That bake is **not in rig-2p5d's plan**; its turned view is for authoring only (decision #6) |
| 3D model | No facing is chosen. The body's yaw turns the model, the camera draws it, and strafing is the graph's 2D blend |
| Component | The resolver writes two new anim-input sources, `action:<id>` and the facing, so a look that keeps its own state machine follows the same decisions |

**Where the code goes.** A new pure module in `engine-layout`, beside `characterClips.ts`, run in
Node by its gate and in the launcher by the tool. The offline loop, the online room and the 3D
view each hand it a sample of the character every frame, never inside a fixed step (§12.8). The
existing `createCharacterAnimator` and `resolveCharacterClip` are not edited: a `characterClips`
block keeps playing through them.

**The proof that lets Salmons move.** A pure converter reads a `characterClips` block, and
Salmons' built-in table, as a sheet. The gate shows that the new resolver over a converted sheet
gives the same clip and mirror as the old code for every cell of `check:flipbook-characters`'
matrix (14,504 cells today), and the same one-shots for a recorded trace of room events.

## 4. Gameplay timing and drawing timing

In a room the server decides when a swipe or a cast takes effect, and it never sees the art.

**Gameplay timing lives on the ability**, in the block the server reads:
`arcade.online.rules.abilities` online, `arcade.abilities` offline. One module steps both
(`engine-mechanics` `abilities.js`). Today a stun or a catch takes effect on the step the ability
is used, holds its target for `ms` and waits `cooldownMs`; a hook casts a line that the rules
module then moves. Two optional fields are added as new exports (decision #5): a wind-up, from the
press to the effect, and a lock: how long, and what the user cannot do meanwhile (move, jump, use
abilities). With neither, an ability steps exactly as today.

**A device** plays its own action at the press, as it raises its own `ability` today, and
everyone else's on the room's event. The art never waits for the hit.

**The tool** reads an ability's numbers from the ability and stores no copy. One strip per action
draws the rule on top (press, wind-up, effect, lock end, cooldown end) and the animation under it
(its length, its `hit` marker). It flags a marker more than one server step off the wind-up, an
animation longer than the cooldown, and an animation longer or shorter than the lock (§12.9). Two
fixes are offered. *Fit the animation* changes the action's playback rate: a drawing change. *Use
the marker as the wind-up* writes the ability: a rules change, so a person presses it and no
agent does.

**What stays out of the art:**

| The rules decide (the server, online) | The art decides |
|---|---|
| when an effect lands, whom it reaches, what it does and for how long | which animation plays, its length and rate |
| the cooldown; what the user cannot do meanwhile | the facing and the mirror |
| scores, statuses, where anyone is | markers for sound and effects; where a held line starts |

No marker, cue or clip length is sent to the server or read by a step. The rule is the 3D view's:
replicate gameplay, never animation.

## 5. The tool

The sheet is the `/characters` page, one foldable card per section.

| Card | State | Reuses, links to |
|---|---|---|
| Character (id, name, look) | exists | |
| View | new | |
| Animation source | new | opens the maker: Flipbook's Characters mode on this character, the Rigger on this rig, the Model Viewer on this model, the Component Editor on the look |
| Draw box and points | new | `BoundsBox.svelte` shown over the preview; the box itself is set in its maker (Flipbook's One Bounds box, the Rigger's Bounds) |
| Actions | new | Flipbook Characters' clips grid (actions down, facings across), moved to `$lib` and fed the sheet; the row's detail and the timing strip under it |
| Preview | new | Flipbook's `CharacterDirections.svelte` (every facing at once, at game size), moved to `$lib`; a rig through `engine-rig`; a 3D model on the `engine-3d` stage the Model Viewer's preview needs |
| Body, Movement, Controller and Jump, Brain, Zone forces | exist | |
| Abilities | exists | gains the wind-up and the lock; lists the online class's abilities |
| Online class | new | edits the same `arcade.online.characters` entry Game Config's Online section edits, and its tap button (decision #4); since 2026-11-21 (in review) also which touch scheme the class is given ([arcade-touch-controls](arcade-touch-controls.md)) |
| Sandbox | exists | gains an Art / Shapes switch |

- **House rules.** Full page, as it is (rule 3). Each card is a `SectionCard` whose description is
  its tooltip, with `InfoTip` and `IconButton` (rule 10, [ui-inventory](../ui-inventory.md) §21;
  the grid is its §2 matrix). The guide changes in the same PR as each card (rule 9).
- **The preview cannot disagree with the game.** It calls the resolver module the game calls, as
  Flipbook's grid calls `resolveCharacterClip`.
- **Links, not copies.** Characters makes no clip, edits no rig and imports no model. An action
  added on the sheet shows in Flipbook's Characters mode as an empty row, where its clips are made
  by name. Flipbook lists a character from its sheet first, then a component's block, then
  Salmons' table. For a character with a sheet, its Facings control becomes a link to the View.
- **Save and lease: unchanged.** The sheet is in the config, so the page keeps its one save, the
  lease it shares with Game Config, its History and its need for the Game Config grant (decision
  #10). It writes nothing outside the config.
- **Scope.** Arcade projects only, as today.
- **Camera and controls.** The Controller and Online class cards hold the controls. The camera
  stays where it is: a screen's world camera in the Scene Editor, the camera rigs in `engine-3d`.
  What a finger does on a phone is a touch scheme
  ([arcade-touch-controls](arcade-touch-controls.md), 2026-11-21, in review): the Online class
  card picks the class's scheme, and a scheme is edited in `/config` only (Mouse and touch).

**As built (C2b).** The cards, in the page's order, between Character and Body: **Character
sheet** (not in the table above: whether the character has a sheet, *Make this a sheet*, *Start an
empty sheet*, the comparison of §9, and removing the sheet), View, Animation source (frame clips),
Draw box and points, Actions, Online class. Where they differ from the table:

- **Draw box and points** has no `BoundsBox` overlay: numbers only. The Actions card's preview
  shows the box.
- **Preview is not a card**: the Directions preview is inside the Actions card, under the grid.
- **Online class is behind the sheet**: it shows with the sheet's other cards, so only for a
  character that has a sheet or whose empty cards were opened. It edits the class's speed,
  places, spawns, random spawn and tap button; the class's abilities are read-only on it.
  Since 2026-11-21 (in review) it also has the class's **Touch scheme** select, the scheme in
  one read-only line and a link to its editor, `/config`'s Mouse and touch card
  ([guide](../tools/invisible-characters.md#online-class)).
- **A class with no character** (Salmons' `salmon`) has nowhere to keep a sheet, so the page lists
  such classes on their own, each with a card that makes the character and its sheet.
- **Kept in step.** A view change keeps the `anim` cells of facings it no longer draws and
  reports them (they are never played; one button removes them). A duplicate keeps the sheet. A
  change of the character's look, or of the class's body in Game Config, to another component
  **unlinks** the class rather than re-pointing it. Game Config's resets say in their
  confirmation how many sheets and class links they remove.
- Flipbook does not list a character a rig or still images draw.
- **Flipbook lists a sheet that is not in force on its own**: the class is listed from the block
  it plays meanwhile, with the reason, and the sheet as a character no class plays yet.

**As built (C6b).** The tool edits all three sources; nothing of a sheet is read-only now.

- **Animation source** opens with a choice of three tiles: Frame clips (the validator's word;
  "Flipbook clips" is in its description), Rig, Still images. A character with no sheet has the
  same tiles on the Character sheet card, and the Whole view's Source row links to the choice.
- **A change of kind keeps every cell.** It asks first, naming what the old source loses (a
  prefix, a rig, variants: another kind cannot store them), and lists the cells the new source
  does not read, with one button to remove them.
- **A rig** has no card of its own: the rig, a rig per facing and the skins are on Animation
  source, the bone of a point on Draw box and points, the grid, the cell editor and the preview
  on Actions. The link "opens the Rigger on this rig" needed a deep link the Rigger did not
  have (`/rigger?rig=<name>`).
- **Still images** are placed many at once (a sheet's images by their names, or one image for
  every action) as well as cell by cell. The region picker is the Scene Editor's, imported, not
  extracted.
- **A character is added by name**: the tool makes the look component. The look select is under
  *Advanced*, since the owner asked what the component was for.
- **Not built:** a rig preview in the Whole view; a view switch from Fill from names.

## 6. Build plan

Every step is its own PR and keeps §9: an engine step also runs `check:runtime-bytes`, the
current-games check and the arcade playbooks, and a tool step updates the guide (`docs-keeper`).
The Gate column names what is particular to the step. "Needs" names the decisions of §7 and the
earlier steps.

| Step | Kind | What | Owner | Gate | After it, the owner can | Needs |
|---|---|---|---|---|---|---|
| **C0** | docs | The map of §1 as links in the Characters guide, with a link back from the Flipbook, Rigger and Model Viewer guides | `docs-keeper` | `check:tool-doc-links` | find every part of a character from one page | none |
| **C1** | tool | **See a character whole.** Every character from all four homes (the config's characters, its online classes, Salmons' built-ins, the 3D looks), joined by look or by id, on read-only cards: the view as implied today, the source, the clips grid and the Directions preview in the real art, the online class and its abilities, a link into each maker | `arcade-games`; `invisible-flipbook` moves its grid and preview to `$lib` | `check:characters-tool`; `check:flipbook-characters` unchanged; a browser run on a local copy of Salmons | open the bear and see its art in every facing, its states, its speed and its swipe, and what is missing, on one page | #1 |
| **C2a** | engine, config | **The sheet and the resolver, for frame clips online**: the fields (sparse), the validator, the resolver and the converter, the online runtime playing a class's sheet, clip reachability reading a sheet | `arcade-games`; `invisible-game-config` | new `check:character-sheet` (§3's proof); `check:game-config-family`; `check:art-scope`; the Salmons playbook | nothing new to click: Salmons is proven to draw the same clips through the new resolver, which C2b and C3 rest on | #2, #3 |
| **C2b** | tool | **Actions as data.** View, Animation source (frame clips), Draw, Actions and Online class become editable; Flipbook's Characters mode lists a sheet's characters and actions | `arcade-games`; `invisible-flipbook` | `check:characters-tool`; `check:flipbook-characters`; one local project published end to end | give an online character a new action (a second attack, a reaction to any room event), make its clips in Flipbook, publish and see it; set width, feet and the hand point without a developer | C2a, #4, #10 |
| **C3** | content | **Salmons moved onto the sheet** (§9), by a person in the tool | the owner or an artist; `game-playtester` | the Salmons playbook; the clip log of `salmons-play.mjs` equal before and after | edit Salmons' characters as any project's | C2b, #8 |
| **C4** | engine, tool | **Offline characters play the sheet**: the loop feeds the resolver; the Side and Top-down rules; the movement triggers a platformer needs; the Flow node; the anim-input sources of §3; the sandbox in the real art | `arcade-games`; `invisible-flow` reviews the node | `check:arcade-characters` and `check:arcade-platformer`, replays unchanged; `check:character-sheet` | animate a single-player character in 2, 4 or 8 directions with no state machine wired by hand; play an action from Flow; try it in the sandbox in its art | C2a |
| **C5** | engine, server, tool | **Timing** (§4): the wind-up and the lock; markers; the timing strip; the online abilities on the sheet | `arcade-games`; `invisible-game-config` | `check:online-rules` (committed traces unchanged, new ones for a wind-up); `check:room-sim`; `check:room-bots` | make a swipe land 200 ms after the press, hold its user still while it casts, and see where a clip disagrees with the rule | C2b, #5 |
| **C6a** | engine, config | **Rig source and still image, online**: one rig mirrored, or a rig or an animation per facing; a cell that names one frame of a project sheet; the online runtime mounting a rig and drawing a still; a rig and a sheet only a character sheet names ship | `arcade-games` with `engine-pixi-svelte`; `invisible-rigger`; `invisible-game-config` | `check:character-sheet` (the rig adapter and the still, each red on a mutation); `check:art-scope` (a rig and a still case); `check:game-config-family`; `scripts/check-rig-runtime-free.mjs`; `salmons-play.mjs --rig` | nothing new to click: a config that names a rig or a still on a sheet is drawn so in a room, which C6b rests on | C2a, #6 |
| **C6b** | tool | **Rig and still on the sheet's cards**: Animation source offers Rig and Still images; a rig picker (one rig, or a rig per facing) that lists the rig's animations and skins and opens the Rigger; a cell's picker for an animation, another rig, or an image of a project sheet; a point tied to a bone; the preview through `engine-rig` | `arcade-games`; `invisible-rigger` | `check:characters-tool`; one local project with a rig and a still published end to end | assemble a rigged character, or put a single image on one, and see it in every facing | C2b, C6a |
| **C7** | tool, engine | **3D source**: the card is the 3D tab [3d-games](3d-games.md) §6 Phase 4 plans (model, clip libraries, sockets, the graph, the default camera rig); a character with a sheet takes its triggers from the action table, not the fixed `ROOM_TRIGGERS3D`; the preview | `games-3d`; `arcade-games` | `check:engine-3d-anim`; `check:engine-3d` | pick a hero's model and clips and map its actions with no hand-written JSON | C2a, #7 |
| **C8** | engine | **Retire the old paths**: Salmons' built-in table, then the `characterClips` block | `arcade-games` | current games; `arcade`'s bytes shrink | nothing new: one way to do it, less code | C3, #9 |
| **C9** | engine, config, tool | **The smooth turn** (§13): `view.turn` on a view of four or eight facings; the animators answer a lean with the picture; the online runtime draws a clip, a still and a rig at it; the View card's controls and a preview that turns the character | `arcade-games` with `engine-pixi-svelte`; `invisible-game-config` | new `check:character-turn` (each rule red on a mutation); `check:character-sheet` unchanged; `check:characters-tool`; `check:runtime-bytes` (slot runtimes the same bytes); `salmons-play.mjs --turn` | make an eight-direction character lean into a turn and sweep through the facings in between, per character, with no art made for it | C2a, C6a |

Order: C0 and C1 first, together. C2a, C2b, C3 in a row. C4, C5 and C6 are independent after C2
(C6a needs only C2a; C6b follows C2b).
C7 waits for C2a and for the 3D game to need it.

## 7. Owner decisions

1. **Start C1 now?** It changes no game and no stored data. (C0 is docs only and waits on
   nothing.) *Recommend: yes.* **Owner, 2026-11-20: yes** ("ok, start with the plan").
2. **Where the sheet is stored** (§12.2): (A) the game config; (B) the look component; (C) a doc
   per character. *Recommend A.* C2a was built on the recommendation (owner told 2026-11-20).
3. **The view: per character, or once per game?** Per character lets Salmons keep a salmon in 4
   facings beside a bear in 8, and the validator holds each to its screen. Per game is one switch
   and cannot mix. *Recommend per character.* C2a was built on the recommendation (owner told
   2026-11-20).
4. **Who edits the online class's numbers** (speed, places, spawns, abilities): (a) both tools, on
   the same entries, as Body is today; (b) only Characters; (c) only Game Config, shown read-only
   on the sheet. *Recommend (a).* C2b was built on the recommendation (owner told 2026-11-20).
5. **A wind-up and a lock as rules** (§4): (a) add both, off unless set, Salmons untouched; (b)
   not now: C5 is then markers and the strip against the cooldown only. *Recommend (a).*
6. **Rig directions** (§3): (a) build one rig mirrored and per facing in C6, and add "bake one
   animation per facing" to rig-2p5d's plan as a phase after its P3; (b) C6 without the 2.5D bake;
   (c) wait for 2.5D before any rig source. *Recommend (a).* C6a was built on the recommendation
   (owner told 2026-11-20): one rig mirrored, a rig or an animation per facing. The 2.5D bake is
   not built and is still to be added to rig-2p5d's plan.
7. **3D** (C7): (a) the sheet's 3D card replaces the 3D tab of 3d-games §6 Phase 4, built when the
   3D game needs it; (b) the same, right after C5; (c) keep a separate 3D tab. *Recommend (a).*
8. **When Salmons moves** (C3): (a) right after C2b, whatever its art's state: the sheet names
   actions and the clips arrive by name; (b) after its S0 art is approved. *Recommend (a).*
9. **Retiring the old paths** (C8): (a) keep the `characterClips` block and Salmons' table as
   fallbacks until the owner says; (b) remove them once Salmons has moved. *Recommend (a).*
10. **Who may edit a sheet.** Characters needs the Game Config grant today, and the `animator`
    role has neither tool. (a) Keep it so; (b) give `animator` Characters and Game Config on
    arcade projects; (c) a narrower save that lets Characters write only character fields, so the
    tool needs no Game Config grant. *Recommend (a) for C2b; revisit with the first animator who
    needs it.* C2b was built on the recommendation (owner told 2026-11-20).

## 8. Ship chain

Rule 8: export, `deploy/`, bake, pull, register.

| What the game needs | Travels today | New |
|---|---|---|
| The sheet (view, actions, markers, points) | It is in the config: Publish and the bake carry it | nothing |
| The look component | An `arcade.characters` look ships even when no scene places it (`runtimeBundle.ts`) | nothing: a class's sheet is such an entry. As built (C2b): this holds for the online publish only; the desktop bake resolves component defs from the scenes alone, so a look no scene places is not in a baked bundle |
| Clips and their sheets | Every clip under a `characterClips` prefix, and Salmons' built-in prefixes (`clipReachability.ts`) | the same walk reads a sheet: its prefix, its variants' prefixes, every clip a cell names (C2a) |
| Rigs | When a scene or a component's rig node names them | a rig only a sheet names: its one rig, its rigs per facing, a cell's rig (C6a, `editorArtExport.ts`) |
| Project sheets | When a sprite, an image param or a played clip names them | the sheet of a still cell (C6a, `editorArtExport.ts`) |
| Models, clip libraries, attached models | Any `modelId` / `modelIds` in the config (`modelExport.ts` finds them by field name) | nothing, while the 3D source keeps those field names |
| `rig3d.json` | Authoring only, never shipped (rig-2p5d §3) | nothing |

A game reads its config after the normalizer, which drops a sheet, and at boot it leaves project
art nothing names unloaded. So the art export also lists a sheet's rigs and still images
(`characterArt`), and both bakes carry the list as a bundle section the boot reads for names
(C6a): without it the rig and the sheet ship and are never loaded.

No new asset class. Three new reachability roots (a sheet's clips, its rigs, its still images). Each is done
when a project whose asset is named **only** by a sheet goes through the whole chain and the
published game draws it: a case in `check:art-scope`, and one real export, bake and pull of a
local project.

## 9. Never break a current game

- **Opt-in by presence.** A character with no sheet fields, which is every character today, takes
  today's path untouched: anim inputs offline, the component's `characterClips` or Salmons' table
  online, `arcade.world3d.looks` in 3D.
- **New exports only.** No existing function of `motion.js`, `behaviours.js`, `abilities.js` or
  `characterClips.ts` changes. Each engine step shows the committed replays and traces unmoved.
- **Sparse config.** A stored config without the new fields comes back byte for byte
  (`check:game-config-family`). A reader ignores a field it does not know
  ([doc-readers](../conventions/doc-readers.md)), so an older runtime plays a newer config the old
  way.
- **Bytes.** `check:runtime-bytes` must show `lines`, `match3` and `card` unchanged after every
  step. So no step edits `SpawnLayer.svelte`, `registerFlipbooks.ts` or any module those bundles
  keep; additions to shared types are type-only; the sheet's normalizer must be shaken out of
  those three bundles, or the block is carried untouched and read by an arcade-only module, as
  `arcade.world3d` is by `engine-3d`. C2a measured it: those bundles keep the normalizer, so the
  sheet is carried (§2), and the resolver imports `game-config` for its types only. `arcade` and `arcade3d` change in the engine steps: the PR
  re-records their manifests and reports the gzip delta. A tool or docs step changes no runtime.
- **Current games.** The harness rebuilds every published game and compares its screens. An
  engine step must leave them the same.

**Salmons, without a flash of wrong art:**

1. C2a releases the resolver. Salmons has no sheet, so it plays through the old functions.
2. The tool shows Salmons' three characters as sheets, read by the converter. *Make this a sheet*
   writes exactly those rows into the config. Nothing is retyped.
3. Before the save, *Compare with the published game* lists every action and facing whose clip or
   mirror would change. The move is ready when the list is empty. As built (C2b): the button is
   *Compare with the saved config*, and it compares the page with the config it loaded or last
   saved, not with a published snapshot.
4. A publish freezes the config and the clips in one snapshot, so no player gets a sheet without
   its clips.
5. The runtime's order is: the sheet, the component's block, Salmons' table, the code look, the
   placeholder. The lower ones stay through C3, so an older runtime, or a rollback of the content
   or of the runtime, still draws the right clips. The sheet is in the config a device has at the
   join, so it is known no later than the component's block is today.
6. C8 removes a fallback only on the owner's word, and only once no runtime older than C2a can be
   served or rolled back to.

## 10. Out of scope

- **Generating the art**: [character-facings-network](character-facings-network.md).
- **The makers' own work**: cutting clips, rigging, importing a model. Characters links to them.
- **New rules**: an effect beyond `stun`, `catch` and `hook`, health, an inventory. That is
  `engine-mechanics` work, per game need.
- **A slot's symbols and match-3's gems**: symbols, authored in Symbols State Machine. They have
  no body, facing or controller.
- **The card family**: a card frame is a component with its own state machine, made in the Card
  Library. Not shared. The resolver is pure and names no family, so a card game with characters
  on a board could take it later.
- **Root motion**: an animation plays in place. The step, or the server, owns every place.
- **Blending between two frame clips or two facings.** A picture still changes in one frame. The
  smooth turn of §13 rotates the picture either side of that change; it does not cross-fade.
- **The camera**: see §5.

## 11. Risks

| Risk | Held by |
|---|---|
| A sheet and an old block describe one character differently | One order of precedence (§9); the tool names which is in force and offers the comparison |
| An action is renamed and its clips, found by name, stop matching | The tool lists the clips the old name found and links to Flipbook's Save a copy; a rename never happens silently |
| `game-config` code reaches the `lines`, `match3` or `card` bundle | `check:runtime-bytes` on every step; the carried-block fallback of §9 |
| The arcade runtime grows | Each engine step reports the gzip delta; C8 gives some back |
| An older launcher build saves the config and drops the sheet (a rollback) | Known for every new config field; History restores it |
| A room draws 100 players through the resolver each frame | It replaces today's per-player animator, one for one; C2a compares the Profiler's readings of a full Salmons room before and after |
| A room draws 100 rigged players | Measured in C6a (headless Chromium, a software rasteriser): the skeleton update is 7 to 70 µs a rig a frame (a clip: under 0.1 µs), so 100 rigs update in 1 to 8 ms. Drawing costs more and grows with the rig's draw calls: 4 to 7 a rig for one that mixes normal and additive slots, about 70 for one whose slots carry a dark tint, against one draw call for 100 clips. A light rig (about 25 bones) fits 60 fps at 100; a rig with dark-tint slots does not fit 30. Held by: the room sends a device only the players near its own and culls the rest; a rig for a crowd keeps to one blend mode and no dark tint; the tool shows a rig's draw calls and calls it light, heavy or too heavy (C6b, §12.7). Not measured on a real GPU or a phone |
| A wind-up changes how Salmons feels | Off unless set; Salmons' rules change only by the owner's hand |
| The Characters page grows too long | Cards fold and remember it; a card with nothing to show for the source is not drawn |
| C1 lists a character twice (a class and its bot's brain share a look) | They are joined by look: one row, both roles shown |
| A 3D character has no look component, and an `arcade.characters` entry needs one today | C7 settles it with `games-3d`: an entry whose source is a 3D model names no component. Until then a 3D character is listed from `arcade.world3d.looks` (C1) |

## 12. Reference

### 12.1 What decides the animation today

| Character | Decided by | Directions | What it can do |
|---|---|---|---|
| Offline 2D | `animInputs` write the look's state-machine inputs each frame (`engine-game` `arcadeCharacters.ts`); the state machine picks a timeline | left and right only (`facing` is 1 or -1) | the states its component's author built; an ability plays nothing unless Flow maps it |
| Online 2D | the clip name rule (`engine-layout` `characterClips.ts` `createCharacterAnimator`); anim inputs are not driven in a room | 4 or 8, with stand-ins for a facing not drawn | three loops (`idle`, `walk`, `holding`) and four room events (`jumped`, `climbed`, `ability`, `caught`): `CHARACTER_CLIP_EVENTS`. The state names in those slots are data |
| Salmons with no clip yet | a look drawn in code (`salmonsArt/`), then a placeholder | none | fixed in code |
| 3D (`arcade3d`) | an animation graph, the component state machine's format extended (`engine-3d` `animGraph.ts`), fed from gameplay (`characterInputs.ts`) | the body's yaw; the camera draws it | inputs `speed`, `localMoveX`, `localMoveY`, `grounded`, `carrying`, `aimPitch`; triggers `jump`, `land`, `attack`, `hit`, fixed in code |

### 12.2 Where the sheet could be stored

| Option | For | Against |
|---|---|---|
| **A. The game config, on the `arcade.characters` entry (recommended)** | §2 | The config holds rules and presentation side by side (it does today: `animInputs`). `game-config` is in every runtime, so its new code must stay out of the other families' bundles (§9) |
| B. The look component, where `characterClips` is | Presentation stays with the look | A second lease and a second save in one page. The server cannot read a component. The launcher's read dropped this very field once ([lessons/components](../knowledge/lessons/components.md)). A 3D look is not a component |
| C. A doc per character in R2 | Clean | A new asset class: the whole rule-8 chain, a new lease, a new History |

### 12.3 Views and facing rules

| View | Facings | Facing rule | Not drawn, so mirrored |
|---|---|---|---|
| Side | `e`, `w` | the sign of the drawn sideways velocity (`clipFacingSideOf`) | `w` |
| Top-down, 4 | `n` `e` `s` `w` | the nearest of four on a flat screen (`clipFacing4Of`) | `w` |
| Top-down, 8 | all eight | `clipFacing8Of`, flat (exists) | `sw` `w` `nw` |
| Isometric, 4 | `ne` `se` `sw` `nw` | `clipFacingOf` (exists) | `sw` `nw` |
| Isometric, 8 | all eight | `clipFacing8Of`, 2:1 (exists) | `sw` `w` `nw` |
| 3D | none | the body's yaw; the camera | none |

`view.mirror: false` is for art that cannot be flipped (a sword in one hand): the mirrored facings
are then drawn too, or stand in unmirrored. `view.facings` is stored only when it is 8. A sheet
with no view is seen as every character was before: isometric, four diagonals.

As built (C2a, `engine-layout` `characterSheet.ts`): a character starts facing `se` (isometric),
`e` (side) or `s` (top-down). The side rule keeps the facing while the direction is within a
quarter of its length of straight up or down; top-down 4 keeps it within 7.5° of a sector's edge,
as the eight-facing rule does. Side and top-down read the world velocity as the screen's when the
screen has no projection, and top-down 8 is always flat. Stand-ins: side tries the other side
mirrored; top-down 4 and every view of eight go outward by angle, each facing before its mirror
twin; isometric 4 keeps today's list. The validator warns on an isometric view on a screen
without `projection: 'isometric'`, a 3D view without `arcade.world3d`, and a side view under a
top-down controller.

### 12.4 Animation sources

| Source | It names | Made in | A cell of the action table holds |
|---|---|---|---|
| Component | nothing more | Component Editor | nothing: the resolver writes the look's inputs |
| Frame clips (`kind: 'clips'`) | a clip prefix | Flipbook | `{ clip }`, or a still image `{ still: { assetKey, region } }`; left empty, the clip named `<prefix>_<action>_<facing>` |
| Still images (`kind: 'stills'`) | nothing more | Atlas Maker, Sheet Maker | `{ still: { assetKey, region } }`: one frame of a project sheet, named as a sprite node names it (the sheet's manifest key and the frame). Nothing is found by name |
| Rig (`kind: 'rig'`) | `rig` (one rig, by its bundle name, as a rig node names it), or `rigs` (a rig per drawn facing), or both | Rigger | `{ anim, rig? }`: an animation name, and another rig; left empty, found by name (below) |
| 3D model | `modelId`, clip libraries (`modelIds`), sockets, the graph (`anim`): the fields `arcade.world3d.looks` has today | Blender, Model Viewer | the graph trigger or state the action fires |

As built (C6a). **A rig's animation is found** for the action, then each action that stands in
for it, through the facings a clip is (the facing, its mirror twin mirrored, the nearest outward).
In a facing the rig is the cell's `rig`, else the facing's own (`rigs`), else the one `rig`; the
animation is the cell's `anim`, else the one named `<action>_<facing>`, else, on a facing's own
rig, the one named `<action>`. When no facing has one, the one rig's `<action>` is drawn in the
facing asked, mirrored when it looks west unless the view's `mirror` is `false`. So three
arrangements need no cell: one rig with `walk` (mirrored), one rig with `walk_ne` and `walk_se`
(an animation per facing), and `rigs: { ne, se }` each with `walk`. An action played once lasts
its animation's length. A rig that is not loaded has no animation, so the character draws as one
with no sheet until it is.

**A still** is drawn through the clip channel, as a clip of one frame registered under
`still::<assetKey>::<region>` (no Flipbook clip id has a colon); played once it is held for one
second. A sheet of still images plays when it has a draw width and an action; a `clips` source
still needs its prefix. A cell of a kind its source does not draw is not read (the validator
warns): under a rig a clip or a still, under clips a rig's animation, under still images anything
but a still.

As built (C6b), read off the resolver while building the tool's grid:

- **an animation named for a facing beats the one rig's plain `<action>` everywhere.** With
  `walk_n` only, south draws `walk_n`: the plain `<action>` is tried only when no facing has one;
- **a rig on a mirrored facing also stands in for its twin**, mirrored, before the one rig's
  `<action>`;
- the validator warns of a `rigs` facing the view does not draw **only when a view is stored**
  (the tool refuses it always);
- a stills sheet whose cells are all of a kind it does not read is a save **error** ("no action
  names an image"), not a warning;
- of a sheet with no source the validator says it "has no frame clips".

### 12.5 Action fields

The fields C2a built are fixed (`game-config` `characterSheet.ts`), and so is `play: hold`
(built 2026-11-20, below); `rate` and `markers` are still proposals (C5).

| Field | Meaning | Left empty |
|---|---|---|
| `id`, `name` | The action. Its id is the `<state>` of the clip name rule | required |
| `when` | What starts it (§12.6): one trigger or a list, any of which starts it | nothing starts it: it only stands in as a `fallback` (and, from C4, Flow plays it) |
| `play` | `loop`; `once` (then the loop under it resumes); `hold` (played once, then its last frame for as long as it is in force: caught, dead) | `loop` for a movement or status trigger, `once` for the others; never `hold` |
| `priority` | One number per action. Of the loops whose trigger holds, the highest plays (a tie: the first in the sheet) | the highest of its triggers': 3 for an event or an ability, 2 for a status, 1 for movement |
| `interrupt` | What may cut a `once`: `priority` (only a `once` of the same priority or higher) or `none` | any other `once`; a loop never cuts it (as today) |
| `again` | Started again while it plays: `ignore` | it restarts (as today) |
| `anim` | Per facing, a cell: `{ clip }`, `{ still: { assetKey, region } }` or `{ anim, rig? }` (§12.4). An empty cell is found by name. A clip variant's art is found by name only | by name |
| `fallback` | The action drawn in its place when it has no animation in any facing (`CLIP_STATE_FALLBACK`, as data) | none: the look's own tree is drawn |
| `rate` | Playback speed; `bySpeed` makes a walk follow the drawn speed | 1 |
| `markers` | Named times in ms from its start, shared by every facing. Presentation only: `hit` is compared with the rule (§4); any other is raised to Flow as a cue (a footstep, a whoosh) | none |

A `once` keeps the facing it started in, as today. A facing with no animation is stood in for by
its mirror twin, then the nearest facing outward, before the `fallback` action is tried: the right
action facing slightly wrong beats the wrong action. A `fallback` is followed until an action
repeats.

As built: an event or an ability always plays its action once, whatever `play` says, and a
movement or status trigger loops only an action whose play is `loop`. A `once` that resolves to
the action the loop already draws does not start. Of two signals between frames the last wins,
and a `once` refused by `interrupt` is dropped, not queued. `interrupt` and `again` are
independent.

**What ends a hold** (as built). A held action's animation is handed on unlooped, so it plays
once and stays on its last frame (a clip's last frame, a rig's last pose; a still is already
still), in the facing it started in, as a `once` keeps it. One rule for clips, a rig and a still;
by the trigger that started it:

- **An event or an ability**: it is a `once` that never ends by itself. Only another `once` its
  `interrupt` lets cut it (by the rules above), the same signal again (`again`), or the character
  drawn afresh (`reset`: an online player shown again after it was put out, a new round) ends it.
  A loop never cuts it, as a loop never cuts a `once`. The validator warns of a hold no other
  action played once may cut (`interrupt: none`, or none as high for `priority`).
- **A movement or a status**: it takes part in the choice of the loop as a loop does (the highest
  priority whose trigger holds). It is played once when it comes into force and held while it
  stays the one in force; when its trigger stops holding, or a higher one holds, it ends, and the
  next time it comes into force it plays again. A `once` played over it starts it again when the
  `once` ends (the clip channel cannot resume a clip on its last frame).

Online, a player the room put out is kept drawn while a held action is in force (its catch held,
or a status hold of `out`), until the room brings it back, it leaves, or a round starts, each of
which draws it afresh (`online.ts` `keptForCatch`). Without a hold it is drawn only while its catch
plays, as before. The converter never writes a hold, so a converted block plays as before.

### 12.6 Triggers

| Trigger | Fires | Offline | Online | 3D |
|---|---|---|---|---|
| `motion` | Found from how the character moves, with no wiring: `still`, `moving`, `rising`, `falling`, `landed`, `onWall`, `hopping` | the loop's own state | the drawn velocity; the room's `jumped`, `climbed` | `characterInputs.ts` |
| `ability` | Its `ability1` or `ability2` is used | the offline abilities stage | the room's `ability`, the own press predicted | the room's `attack` |
| `event` | A rules event names the character as its user or its target (`caught`, `hooked`, `hit`, a rules module's own) | loop signals | room events | room one-shots |
| `status` | While a status holds: `stunned`, `out`, `hooked`, `holding`, `marked`, `carrying` | the ability module's statuses | the room state | `carrying` |
| `brain` | While its brain is in a state | yes | no: a bot is drawn from what it does, as a person is | no |
| `flow` | A Flow node, *Play character action* (new, presentation only) | yes | yes | yes |

Built in C2a, for an online room: `motion` (`still`, `moving`), `ability`, `event` and `status`.
An event's user is the room event's `player`, or its `by` (`hit`, `caught`, `hooked`, `escaped`
name their user so); `as: 'target'` is its `target`. The statuses a room feeds are `holding`,
`marked` and the room status' name (`free`, `stunned`, `out`, `grounded`, `hooked`). The other
movement states, `brain` and `flow` arrive with C4.

### 12.7 Draw box, attach points, variants

| Field | Frame clips | Rig | 3D |
|---|---|---|---|
| Width (`draw.width`; `displayWidth` today) | the clips' shared Bounds box is drawn this wide; a still's frame is | the skeleton's Bounds box is drawn this wide | none: the model is in metres |
| Feet (`draw.feet`, stored unless 1; `anchorY` today) | where the ground is down the box | the same | the model's origin |
| Attach points (`draw.points`; `hand` today) | a named point across and down the box, mirrored with the art | `draw.bones`: a point name to a bone name, read before `draw.points`; a bone the rig lacks falls back to the point on the box | a socket (`SK_<name>`), and the model attached to it |
| Variants (`source.variants`, by status name; `prefixes.marked` today) | a second art set tried first while a status holds | a skin: the first whose status holds and that the rig has | a material or a model |

As built (C6a): a rig's box is the Bounds box of its header (the Rigger's), at the scale it was
loaded at; a rig with none takes its bounds in the first pose it is drawn in. The middle of the
box, at `feet` down it, is the character's place, and a mirrored rig is flipped about that place.

As built (C6b): the game reads only `hand` from `draw.bones`; the tool stores any other and says
it is not read yet. **A rig's cost** is shown as the draw calls of its dearest pose over every
animation, not of its setup pose: a rig whose setup pose draws nothing would read as free. Light
is up to 7 draw calls a character and too heavy 70 or more (C6a's measurement, §11); between
them nothing was measured.

### 12.8 Who feeds the resolver

| Runtime | The sample comes from | It draws through |
|---|---|---|
| Offline loop (`engine-game` `arcadeCharacters.ts`) | the character after the frame's fixed steps | the per-instance clip channel an online room uses today (`arcadeClips.svelte.ts`) |
| Online room (`apps/lines` `online.ts`) | drawn places, room state and room events, as `drawClips` reads them today | the same channel |
| 3D view (`engine-3d`) | `characterInputs.ts` | its mixer and graph |

A rig mounts through the channel Salmons' code looks use (`arcadeArt.svelte.ts`), confirmed by
C6a: `online.ts` publishes one mount per rigged player, and `<SpawnLayer>` draws it in place of
the instance's own tree without knowing it is a rig. The rig's drawing
(`engine-layout/sheet-rig`, one `RigView` per player) is a lazy chunk fetched by the first class
whose sheet names a rig. A still needs no channel of its own: it is a clip. A converted `characterClips` block's `ability` row answers either button, as the
block does (two `ability` triggers on one action).

Online (C2a): `online.ts` reads a class's sheet off the baked config as it is, before the
normalizer (`onlineClassSheetOf`), once per class. A class plays its sheet when the sheet has a
clips source, a draw width, an action and a view with facings; otherwise it takes the lower
paths of §9. A sheet in force whose clips are not registered draws the code look or the
placeholder, never the component's block. From C6a a class also plays a sheet of still images
(through the same clips) and one whose source is a rig; a rigged player has no clip, and its rig
takes the place of a code look.

### 12.9 The timing strip's flags

| Flag | Means |
|---|---|
| The `hit` marker and the wind-up differ by more than one server step (1000 / `tickHz` ms; 33 ms at the default 30) | the blow lands before or after it looks like it does |
| The animation is longer than the cooldown | a held button restarts it before it ends |
| The animation is longer than the lock, or shorter | the character slides while it still swings, or stands frozen |
| No wind-up, and a `hit` marker later than one step | the game hits on the press, whatever the clip shows |

With a wind-up, the room's `ability` event still marks the press and the hit arrives as its own
event. The wind-up and the lock are counted in fixed steps by the room and by the offline loop,
and predicted for the own player as a cooldown is today. An ability with neither steps as today,
so no committed trace moves.

### 12.10 The sheet, sketched

The names are C2a's, but for `markers` (C5). Existing fields are unchanged. A rigged character's
source reads `{ "kind": "rig", "rig": "bear", "variants": { "marked": "gold" } }` with
`"draw": { "width": 92, "bones": { "hand": "hand_r" } }`; a single image is
`"source": { "kind": "stills" }` with one action whose cell is
`{ "still": { "assetKey": "<client>/<project>/manifests/atlas_manifest_<sheet>.json", "region": "<frame>" } }`
and every other action's `fallback` naming it.

```jsonc
// arcade.characters[]  — today: id, name, component, movement, controller, brain, animInputs
{
	"id": "bearBot",
	"component": "salmonsBear",
	"view": { "kind": "isometric", "facings": 8 },
	"source": { "kind": "clips", "prefix": "bear" },
	"draw": { "width": 92, "points": { "hand": { "x": 0.75, "y": 0.4 } } },
	"actions": [
		{ "id": "idle", "when": { "motion": "still" }, "fallback": "walk" },
		{ "id": "walk", "when": { "motion": "moving" }, "fallback": "idle" },
		{ "id": "swipe", "when": { "ability": "ability1" }, "fallback": "idle",
		  "markers": [{ "id": "hit", "at": 180 }] },
		{ "id": "roar", "when": { "ability": "ability2" } },
		{ "id": "grab", "when": { "event": "caught" },
		  "anim": { "e": { "clip": "bear_grab_side" } } }
	]
}
// arcade.online.characters[]  — today: id, body, speed, max, spawns, randomSpawn
{ "id": "bear", "body": "salmonsBear", "speed": 190, "sheet": "bearBot" }
```

The sketch is Salmons' bear. In Salmons today the config's characters are the bots' brains
(`bearBot`, `fishermanBot`) and the classes are `salmon`, `bear`, `fisherman`. `bearBot` already
has the bear's component as its look, and a component is the look of one character at most, so
`bearBot` becomes the bear's sheet as it is, with no rename; the salmon gets a new entry (as
built, C2b: `salmonsSalmon`, its component's id). The
`roar` and `grab` rows are examples of what a project could add, not Salmons' rules. The
validator's "a character no bot plays does not run in a room" must not fire for an entry a class
names as its sheet: `sheetAwareIssues` drops it for the save, and for the pages' own lists (as
built, C2b).

### 12.11 Where the facts were read

| Fact | File |
|---|---|
| The clip block, its three loops and four events | `packages/engine-layout/src/lib/types.ts` (`CharacterClips`, `CHARACTER_CLIP_EVENTS`) |
| The facing rules, the stand-ins, the state fallback, the animator | `packages/engine-layout/src/lib/characterClips.ts` |
| Salmons' table | `packages/engine-layout/src/lib/referenceLayouts/salmonsClips.ts` |
| Which block a class plays; room events to one-shots | `apps/lines/src/game/online.ts` (`clipLookOf`, `gameClipsOf`, `raise`, `drawClips`) |
| Offline anim inputs; `facing` is 1 or -1 | `packages/engine-game/src/game/arcadeCharacters.ts`; `packages/game-config/src/arcadeCharacters.ts` |
| The online class and ability fields | `packages/game-config/src/family.ts` (`ArcadeOnlineCharacter`, `ArcadeOnlineAbility`) |
| A stun or a catch takes effect on the step it is used; a hook goes to the rules module | `packages/engine-mechanics/src/abilities.js` (`useAbilities`) |
| The 3D look, graph, inputs and triggers | `packages/engine-3d/src/pure/looks.ts`, `animDoc.ts`, `animGraph.ts`, `characterInputs.ts` |
| Which characters Flipbook lists | `apps/launcher-api/src/lib/flipbook/projectCharacters.ts` |
| What ships | `apps/launcher-api/src/lib/server/clipReachability.ts`, `runtimeBundle.ts`, `modelExport.ts` |
| The sheet: its fields, normalizer, raw-doc readers, validator | `packages/game-config/src/characterSheet.ts` |
| The resolver, the new facing rules, the converter, the rig adapter, a still as a clip | `packages/engine-layout/src/lib/characterSheet.ts` |
| The smooth turn: its angles, and the animators that drive them | `packages/engine-layout/src/lib/characterTurn.ts`; `characterSheet.ts` (`createAnimator`) |
| A rig drawn by its sheet (the lazy chunk) | `packages/engine-layout/src/lib/sheetRigLook.ts` (`engine-layout/sheet-rig`) |
| A sheet's rigs and still sheets in the art export | `apps/launcher-api/src/lib/server/editorArtExport.ts` |
| The launcher's carry of the sheet past the normalizer | `apps/launcher-api/src/lib/server/gameConfigStorage.ts` |

## 13. The smooth turn

A view of four or eight facings draws one picture per facing, and the picture changes in one
frame when the facing does. `view.turn` makes that change continuous, per character, with no art
made for it. Off (absent) by default: a sheet without it is drawn exactly as before.

```jsonc
"view": { "kind": "isometric", "facings": 8, "turn": {} }          // on, at the defaults
"view": { "kind": "topDown", "turn": { "lean": 30, "speed": 0 } }  // four facings, the lean alone
```

| Field | What | Default | Range |
|---|---|---|---|
| `turn` | Present ⇒ on. `{}` is on at the defaults | absent (off) | an object |
| `turn.lean` | The most the picture is rotated from its facing, degrees | half the angle between two facings: 22.5 of eight, 45 of four | 0 to that half |
| `turn.speed` | How fast the drawn heading follows where the character moves, degrees a second. 0 ⇒ at once | 360 | 0 to 3600 |

Sparse like the rest of the sheet: a value at its default is not stored. A side view has two
facings and nothing to turn through, and a `3d` view has none (the body's yaw turns the model):
neither has the option, the normalizer drops it there and the validator says so.

**How it is drawn.** Three things, in this order, each frame:

1. **The aim.** The facing rule of §12.3 is not changed and no second one is added. What it
   answers, dead bands and the 150 ms turn hold included, is the facing the character is *aimed*
   at: exactly the facing a sheet without the option draws. While the direction it moves in is
   that facing's by the rule, its heading is aimed at too, held inside the facing's sector; while
   a turn is in hand, the aim waits as the facing does.
2. **The drawn heading** follows the aim the short way round at `speed`. The picture is the
   facing whose sector the drawn heading is in, so a reversal is drawn through the facings in
   between. It goes on while the character stands, and a `reset` ends it where it was aimed.
3. **The lean** is the drawn heading's distance from the middle of the facing the picture is
   *seen* in (a stand-in's own facing; a one-shot's or a hold's, the one it started in), at most
   `lean` either way.

At the default lean a picture changes on the very edge of two sectors, where the old picture
leans half a sector one way and the new one half a sector the other: both are drawn in the same
direction, so nothing jumps. A smaller lean leaves a step of the difference at each change. A
heading that sits on an edge changes nothing: the aim crosses an edge only when the rule turns
the facing, so its dead band and its hold are the hysteresis.

**The angle is the screen's.** Headings are measured on the ground, with the screen's flattening
taken out (the space the facings are 45° or 90° apart in, as `clipFacing8Of` has it). The lean
handed to the renderer is that angle as it is on the screen: on the 2:1 isometric screen the
facings are 26.6° and 63.4° apart, so the picture of `e` leans 11.7° to the edge it shares with
`se` and the picture of `se` leans 14.9° back to it.

**What turns.** The picture, about the character's place: the point the sheet's `draw.feet`
already puts on the ground, which is the pivot the mirror uses too. The rotation is applied after
the mirror, so a west facing drawn as its east twin leans the way the character turns. A body
point (`draw.points`, `draw.bones`: the hand a line is held from) turns with it. What is not
part of the body stays upright: the shadow and the mark's glow on the ground, a text rising over
the player, the line itself.

**It is drawing only.** The simulation's heading, the movement, collisions, abilities' aim and
the game server never read it; a room's state and its replays are the same with it on.

**Where the code is.** The angles are `engine-layout` `characterTurn.ts` (pure); the animators
of `characterSheet.ts` hold the state and answer `lean` on a frame only for a sheet that has the
option. A rig is rotated by its look (`sheetRigLook.ts`). A clip or a still is drawn through the
shared `<SpawnLayer>` clip channel, which every runtime bundles; so a character that turns
smoothly is drawn by an arcade-only look instead (`engine-layout/sheet-clip`), mounted through
the channel a code look uses, and the slot runtimes stay the same bytes.

**Not in it.** Cross-fading two pictures; a lean for a side view; a different pivot per action;
easing of the sweep (it turns at a constant rate).
