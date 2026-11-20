# Invisible Characters

Author the **characters of an arcade game**: the things on the play field that move by
themselves — a guard that patrols and chases, a fish that flees, a paddle the player drives. Each
one is a **look** (a component), a **body**, **movement** settings, a **controller** when the
player drives it and a **brain** when it acts on its own. A character an online room draws can
also have a **character sheet**: its view, its frame clips, its draw box and the actions it can be
seen doing. A **sandbox** below the editor runs the character for real, with placeholder shapes, so
you can try it before you save.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/characters` (granted to `developer`,
  `artist` and `pipelineTester` by default — the same roles as Invisible Game Config; `admin`
  always).
- **Scope:** per **active project**, and **arcade projects only**. A slot or match-3 project does
  not list the tool, and a direct link shows "Invisible Characters is not used by slot games" (or
  "match-3 games") with a link back to the launcher.

## Where each part of a character is made

This tool holds a character's body, movement, controller, brain and abilities, and its character
sheet. The rest of a character is made in other tools; this is where to find each part.

| Part | Made in | Guide |
|---|---|---|
| Drawn frames | Invisible Atlas Maker, Invisible Sheet Maker | [Atlas Maker](atlas-maker.md), [Sheet Maker](sheet-maker.md) |
| Frame animations (clips) | Invisible Flipbook, Clips mode | [Flipbook](flipbook.md) |
| A character's clips for each facing | Invisible Flipbook, Characters mode | [Characters mode](flipbook.md#characters-mode--a-characters-whole-set-of-clips), [Salmons character sprites](../guides/salmons-character-sprites.md) |
| Skeletal animation | Invisible Rigger | [Rigger](rigger.md) |
| The look: which timeline plays when | Invisible Component Editor | [Component Editor](component-editor.md) |
| Body, movement, jump, controller, brain, abilities, zone forces | This tool | this page |
| The character sheet: view and facings, clip prefix and variants, draw width, feet and points, the actions and which clip each plays in each facing | This tool, for a character drawn from frame clips in an online room | [The character sheet](#the-character-sheet) |
| An online character's class: speed, places, spawns, the tap button | Invisible Game Config, Online; or this tool's **Online class** card, on the same entries | [Game Config](game-config.md), [Online class](#online-class) |
| An online class's id, its body and its abilities | Invisible Game Config, Online | [Game Config](game-config.md) |
| A 3D character's model and its quality tiers | Blender, then Invisible Model Viewer | [Model Viewer](models.md), [3D asset conventions](../conventions/blender-3d-assets.md) |
| Which clips an online character plays, **with a sheet** | This tool: the sheet's **Actions** card | [Actions](#actions) |
| **Which clips an online character plays, with no sheet** | **No tool.** A developer writes the component's clip block; Flipbook sets only its facings. **Make this a sheet** turns that block into a sheet | [Character sheet](#character-sheet), [Flipbook status](../status/flipbook.md) open item 7 |
| **Which model, clips, sockets and animation graph a 3D character uses** | **No tool.** A developer writes the `arcade.world3d` JSON; Game Config has no editor for it | [3D status](../status/3d.md) |

Where this is going: [Character pipeline](../design/character-pipeline.md) (the plan; how far it
has got is in [the status file](../status/game-families.md)).

## Where the characters are stored

The characters live **inside the game config** (`arcade.characters` in the project's Game Config
document; their abilities in `arcade.abilities`, the zone forces in `arcade.forces`). A character
sheet is on the character's own entry, and an online class names the character whose sheet draws
it. So:

- they ship with the config — no extra export: Publish and the bake carry them, and each
  character's look (and every `shootAt` shot component) is shipped even when no scene places it;
- **Save** writes the whole game config through the same save as Invisible Game Config, with the
  same conflict check and the same **History** of versions (open it from Game Config);
- the two tools share **one edit lease**: while someone has Game Config (or this tool) open on the
  project, the other shows read-only with **Take over**. Two people cannot edit both at once;
- the page holds the whole game config (paytable included), so it needs the Game Config grant as
  well: a user given this tool without Game Config is refused (403), as `/config` would refuse them;
- the whole config must be valid to save. Errors outside the characters (and their abilities and
  zone forces) are listed in a note at the
  top ("fix them in Invisible Game Config") and keep **Save** disabled.

If the project's config is not an arcade config (its family is not set to Arcade in Game Config),
the page says so and stays read-only.

## The page

### The characters list (left)

Each row shows the character's name (or id), its look, and `played` / `brain` when it has a
controller or a brain; a red dot marks a character with errors.

- **＋ Add** — pick a component in the dropdown and add a character whose look it is. The new
  character's id is the component's id. The dropdown only offers components no character uses
  yet: **a component is the look of one character at most**.
- **Classes with no character** — shown under the list when the game is played online and a class
  of the room is drawn as a component no character has (Salmons' `salmon`). Such a class has
  nowhere to keep a sheet. Pick one for its own card:
  [An online class with no character](#an-online-class-with-no-character).

A link can open the page on one character: `/characters?character=<id>`. Add `&card=<card>` to
unfold and scroll to one card of its sheet (`sheet`, `view`, `source`, `draw`, `actions` or
`online`), and `&project=<key>` to open that project. An id the config does not have is ignored
(the first character is selected, and the card is ignored with it). Flipbook's **View ↗** and Game
Config's **Sheet** column link here this way.

### Character

- **Id** — the name the brain, Flow and the runtime use. Type a new one and press **Rename**; a
  blank or taken id is refused with a message. An online class that names this character as its
  sheet follows the rename, and a line under the buttons says which classes did. (It also says
  when a class already named the new id, a character the config did not have: that class is
  drawn from this sheet from now on.)
- **Name** — an optional display name (blank shows the id).
- **Look (component)** — the component a spawned instance of which _is_ this character. Every
  component of the project (and the shared and built-in ones) is offered. A class and its sheet
  use the same component, so a class that names this character's sheet and is another body
  **loses its link** when you change the look; the same line says which. The class's body is
  never changed from here.
- **Duplicate** — copies the character, right below it, as `<id>Copy`. The copy keeps the same
  look, which is an error until you pick another one. It keeps the character sheet too; no class
  names the copy, so nothing is drawn from it until one is linked.
- **Delete** — asks first. The brain, controller, movement and anim inputs go with it; its
  component and its body stay. Its character sheet goes with it, and the question names the
  classes that lose their link to it (they are drawn as before the sheet).

### The character sheet

Under **Character** come the sheet's cards. A sheet says, as data, how an online room draws the
character: how it is seen, which frame clips draw it, how big, and what it can be seen doing. An
online class that names the sheet is drawn from it; a class that names none, and every character
with no sheet, is drawn exactly as before.

A character with no sheet shows only the first card. The other five appear once it has a sheet,
or once you press **Start an empty sheet** (or a link opens one of them). **Nothing is written
until you use a control**: opening the empty cards changes nothing.

Each card lists the problems that concern it, errors in red and warnings in amber. An edit that
cannot be stored (a blank prefix, a width of 0, a name already taken) is refused with the reason
under the control, and the field goes back to what is stored.

What a sheet holds today: a view, **frame clips** as the animation source, a draw box and
actions started by movement, an ability button, a room event or a status. See
[Known limitations](#known-limitations--todos) for what it does not hold yet.

#### Character sheet

Says whether the character has a sheet and who plays it: **Played by "bear"**, or that no online
class names it yet (the game then draws nothing from it).

- **Make this a sheet** — writes the clip block the character plays today as a sheet, row for row,
  with nothing retyped. It is made from the block the first online class drawn as this
  character's component plays (its component's clip block, else Salmons' own table), and that
  class then names the sheet. With no class drawn as it, the sheet is made from the component's
  own clip block and no class is linked. The button is greyed out when there is nothing to make
  it from: a class is drawn as the character but plays no clip block. A note says what it was
  made from.
- **Start an empty sheet** — shows the five empty cards, to fill a sheet in by hand.
- **Compare with the saved config** (a character with a sheet) — for every class that names the
  sheet or is drawn as the character's component, says what drew it in the saved config and what
  draws it now (`bear: saved, a clip block; now, the sheet of "bearBot"`), then either **No
  difference** or two lists:
  - the **drawn differences**: each action and facing whose clip or mirror changed, with the old
    and the new clip (`walk, facing ne while marked: … → …`), and any action or facing only one
    side has. Every cell is tried with no status, under each variant's status, and under all of
    them together;
  - the **differences in what the sheet says**, whatever clips exist: the view, the prefix and
    variants, the draw box, the order of the actions, and per action what starts it, how it plays,
    its priority, what cuts it, its named clips and its stand-in.

  Right after **Make this a sheet** it says **No difference**: that is the check to make before
  saving a character moved onto a sheet. Its limits:
  - **the saved config is not the published game.** It is the config this page loaded, or last
    saved. A game published before your last save may still differ from it;
  - the drawn differences are worked out with the clips the project has now, so they say nothing
    about clips not made yet (the second list covers what the sheet says regardless);
  - after a Save the saved config _is_ the page, so there is nothing left to compare against.
    Compare before you save.
- The **bin** in the header removes the sheet (its view, source, draw box and actions) after a
  question. The classes that name it keep their link and are drawn as before the sheet until the
  character has one again.

#### View

How the game sees the character, which decides the facings it is drawn in.

- **Kind** — _Not set (isometric, 4)_, **Side** (east and west), **Top-down** or **Isometric**.
  With none set the character is drawn in the four isometric diagonals, as every character was
  before sheets.
- **Facings** (top-down and isometric) — **4 facings** or **8 facings**.
- **Mirror the west facings** — on, a west facing is its east twin drawn mirrored and no art is
  made for it. Off, for art that cannot be flipped (a sword in one hand), every facing is made.
- The three lines under the fields say what that comes to: **Draws**, **Art is made for** and
  **Mirrored**.
- The **reset** icon takes the view away.

Warnings here:

- **The view against the screen.** _An isometric view on a flat screen_, or _a side_ / _top-down
  view on an isometric screen_: the facings will not match how the character moves. The page
  reads the project's screens for this (isometric when any screen is). A save does not check it,
  so the warning shows here and in Game Config only. Also: a side view under a top-down
  controller.
- **Clips named for facings the view does not draw.** Changing the view keeps the clips you named
  in cells of facings it no longer draws (going from 8 facings to 4 and back loses no work). They
  are listed, are never played, and **Remove them** deletes them.

A 3D view cannot be picked (the only source is frame clips, which a 3D view does not draw); one
already stored is shown as _3D (stored)_ and kept until you pick another.

#### Animation source

What draws the character. One kind today, **frame clips**: every clip is found by its name,
`<prefix>_<action>_<facing>`, among the project's Flipbook clips.

- **Clip prefix** — the first part of that name (`bear`).
- **Variants** (once there is a prefix) — a second set of art, drawn first while a status holds
  (Salmons' golden salmon while it is `marked`). Each row is **While** (the status) and **Prefix**;
  a clip the variant lacks falls back to the base one. Fill the last row and press **Add
  variant**; the bin removes one.
- **Flipbook ↗** in the header opens Flipbook's Characters mode on this character, where its
  clips are made. Nothing is made here.
- The **bin** takes the source away, with its variants.

Warning here — **a name storage cannot match.** Flipbook stores a clip under a lower-case id
(letters, digits and `_`), and the game asks for a clip by that id exactly. A prefix or a
variant's prefix with a capital or another character matches no clip; the warning says how
Flipbook would store it.

#### Draw box and points

How big the character is drawn and where it stands. Numbers only: the box itself is set where the
art is made (Flipbook's **One Bounds box**), and the preview on the Actions card shows it (tick
**Box and feet**).

- **Width (world px)** — how wide the art's Bounds box is drawn. Frame clips need one: without it
  the sheet cannot be saved.
- **Feet** (once there is a width) — where the ground is down the box: 0 is its top, 1 its bottom
  (the default). The character stands on that line.
- **Points** — a named place on the box the game can attach to (`hand`: where a carried thing is
  held), **Across** and **Down** the box from 0 to 1, mirrored with the art. Type a name and press
  **Add point**: it lands in the middle.
- The **bin** takes the draw box away, with its feet and its points.

#### Actions

What the character can be seen doing: one row per action, then the clips grid and the preview.

| Column | Meaning | Empty |
|---|---|---|
| **↑ / ↓** | The order. Of two loops as high, the first in the list plays | |
| **Id** | The middle of its clips' names, `<prefix>_<action>_<facing>` | required |
| **Name** | A display name | the id |
| **Starts on** | Its triggers; it starts on any of them. **＋ Add** offers **Movement** (_Standing still_ / _Moving_), **Ability** (_Ability 1_ / _Ability 2_), **Event** (a room event's name, and whether _It does it_ or _It is done to it_) and **Status** (_While_ a status holds). **×** removes one | _nothing_: it only stands in for another action |
| **Plays** | **Loop** or **Once** | _By its triggers_: a loop for movement or a status, once for an ability or an event |
| **Priority** | Of the loops whose trigger holds, the highest plays | the highest of its triggers': 3 an ability or an event, 2 a status, 1 movement |
| **Cut by** | What may cut it short while it plays once: _Same priority or higher_, or _Nothing_. A loop never cuts a once | _Any other once_ |
| **Again** | Started again while it plays: _Plays on_ | _Restarts_ |
| **Stands in** | The action drawn in its place when it has no clip in any facing. A facing with no clip is first stood in for by its mirror twin, then the nearest facing | none |

The event and status fields suggest the names a room raises (`jumped`, `climbed`, `hit`,
`caught`, `hooked`, `escaped`; `holding`, `marked` and the room's statuses) and take any other,
since a rules module may raise its own.

Type an id in the last row and press **Add action** (blank gives `action`, `action2`, …). The bin
removes an action; the actions it stood in for lose that stand-in, and a note says which.

**Renaming an action changes which clips it finds**, since they are found by name. The note under
the table lists the clips that no longer match and how many match the new name; the actions it
stood in for follow the rename.

Warnings here:

- **A name storage cannot match**: an action's id, or a clip named in a cell, with a capital or a
  character a clip id cannot have, or a clip name longer than the 60 characters an id holds.
  Rename the action, or name its clip in each facing.
- **Clips named for facings the view does not draw** (see [View](#view)), per action.
- From the save: two loops on the same trigger at the same priority (only the first plays), no
  action for standing still, a stand-in that names no action. Frame clips with no action cannot
  be saved.

**The clips grid** (shown once the sheet has an action) is the one Flipbook's Characters mode
shows, fed the sheet as it is on the page: actions down, facings across, each cell the game's own
answer — ✓ its own clip · ⇋ its twin, mirrored · ≈ another clip stands in · — nothing plays. The
line above counts the clips made and the cells that draw nothing. A sheet with variants has a
**base / variant** switch in the card's header.

**Press a cell** to open its editor under the grid. It says what the game draws there, and has:

- **Clip** — leave it empty and the game finds the clip by name. Name one of the project's clips
  (the field suggests them) to draw that clip in this cell instead; the cell then has a double
  border. A name the project has no clip for is flagged.
- **By name** — clears the cell back to the name rule.

**The Directions preview** under it is Flipbook's too: the action in every facing at once, at
the game's size, in the real art, mirrored and stood in for as the game does. Pick the action
with the switch, press a facing to select its cell, and tick **Box and feet** to see the draw
box. A clip that was not read with the page (one under a prefix you just typed) is drawn once the
sheet is saved; the cell editor says so.

#### Online class

The online classes drawn as this character's component, each with:

- **whether it is drawn from this sheet**: _drawn from this sheet_; _names this sheet, not
  played_, with the reason (no clip prefix, no draw width, no action, a 3D view); _names the
  sheet of_ another character; or _names no sheet_;
- **Draw it from this sheet** / **Unlink** — link the class to this character's sheet, or take
  the link off (the class is then drawn as before the sheet). Linking needs a sheet, and a class
  of the same component: a class and its sheet use the same component;
- its numbers, **the same entries Game Config's Online section edits** (an edit in either tool
  shows in the other): **Speed px/s**; **Places** (how many players of a room can be it; empty
  for any); **Spawns** (`x, y; x, y` in world px; empty for the room's spawn); **Spawn at random**
  (off, its spawns are taken in turn; it needs spawns of its own); **A tap presses** (the button a
  tap or a click presses: _Nothing (it only steers)_, _Jump_, _Ability 1_ or _Ability 2_; it
  needs mouse and touch control, switched on in Game Config);
- the room's **abilities** for the class, read-only (button, effect, reach, targets, holds,
  cooldown, once a press or while held).

A class's id, its body and its abilities are set in Game Config: **Game Config, Online ↗** in the
header opens it. A game not played online, or a character no class is drawn as, says so here.

### An online class with no character

Pick a class under **Classes with no character** (Salmons' `salmon`) for its card, **Online class
`<id>`**. It shows the class's **Body** and what it **Plays** (a clip block, with its prefixes and
the width it is drawn at, or no clip block).

- **Make this a sheet** — adds a character whose look is the class's body (its id is the
  component's, so Salmons' `salmon` gets `salmonsSalmon`), writes the clip block the class plays
  as that character's sheet, row for row, names it on the class, and opens the new character.
  Greyed out when the class plays no clip block.
- **Add a character with no sheet** — adds the character only.

### Body

The body of the look component — **the same entry** as Game Config's _Arcade bodies_ table, so an
edit here shows there and the other way round: shape (box or circle), size, tags, how it meets the
field's edges (`clamp`, `wrap`, `pass`), **Solid** (stops the characters that move into it),
**Ground** (ground level: a character in the air on a top-down hop passes over it) and **One-way**
(a platform that stops a falling character from above only; greyed out on a solid body, which
blocks from every side — ticking Solid clears it). A look with no body says _No body: it touches nothing_ with an **Add a body** button (a 100 × 100
box).

### Movement

How the velocity follows what the character wants, all optional:

| Field | Meaning | Empty |
|---|---|---|
| Accel px/s² | speeding up towards the wanted velocity | instant |
| Decel px/s² | slowing, stopping, reversing | same as accel |
| Max speed px/s | a cap on its speed | no cap |
| Turn rate °/s | how fast the heading may turn | instant |
| Gravity px/s² | a downward pull: the character falls, and only its left / right is steered | no pull |
| Max fall px/s | a cap on how fast it falls | no cap |

With a side-scroll **jump**, Gravity is the pull while it falls (the jump's own height and time set
the rise); left empty, it falls under the jump's own pull. A **flap** needs Gravity (without it, one
flap sends it up for ever — the validator warns).

### Controller

**Played with:** _none_ (not playable), _top-down_ (8-way), _side-scroll_ (left / right), _flap_
(tap to kick up, Flappy-style) or _pointer_ (follow a pressed mouse button or a finger on the **x**,
**y** or **xy** axes; a new pointer controller starts on **x**).

- **Speed px/s** — a keyboard controller needs one (200 by default). A pointer controller may leave
  it empty: it then moves at the movement's max speed, or jumps straight to the pointer with none.
  A flap's speed is how fast left / right run it; empty, it only rises and falls.
- **Kick px/s** (flap) — the upward speed each press gives it (360 by default; must be above 0).
- The keyboard controllers read the Flow input map's actions **`left`, `right`, `up`, `down`** —
  map the keys to them in Invisible Flow. With none of them held, a pressed pointer or a touch
  steers instead.
- A jump or a flap reads the **`jump`** action (a side-scroll jump and a flap read `up` too). On a
  touch screen a side-scroll character jumps on a press above it and a flap on a press anywhere; a
  top-down hop has no touch gesture (a touch steers it). The hint under the controller says which.

Switching between controllers keeps the speed (a keyboard controller falls back to 200); between
top-down and side-scroll it keeps the jump too, switched to the other kind. A pointer takes no jump.

#### Jump (top-down and side-scroll)

Tick **Jump** to give the controller one. Its kind is fixed by the controller: a side-scroll gets a
**side-view jump** (it leaves the ground and falls back under gravity), a top-down one a **hop** (it
rises off the ground plane on a height arc, drawn lifted with a shadow, and while it is up it passes
over **Ground** bodies). A fresh jump is 120 px high and 0.4 s to the apex.

| Field | Meaning | Empty |
|---|---|---|
| Height px | how high the apex is above the take-off | — (required) |
| Time s | seconds from take-off to the apex | — (required) |
| Tap height px | how high a quick tap goes: hold to jump higher | every jump is full height |
| Coyote ms | a press this long after walking off a ledge still jumps | 100 |
| Buffer ms | a press this long before landing jumps on landing | 100 |
| Air control 0–1 | how much you steer in the air | 1 (full) |

A field at its default (Coyote 100, Buffer 100, Air control 1 or more) is not stored. Below the
fields, a read-only line shows what the height and time come to: the **launch speed** (2 × height
÷ time), the **pull** while rising (2 × height ÷ time²) and, with a tap height, the speed an early
release cuts the climb to. A tap height above the height warns (a tap then jumps as high as a held
press). Untick **Jump** to remove it.

A character with a controller **and** a brain is a **bot** when the game hands it to its brain
(Flow's _set character control_).

### Brain

The brain is drawn on the **same state-machine canvas as the Component Editor**: an **Entry** pill
wired to the state it starts in, an **Any** pill, one card per state (its id, and its behaviour
underneath) and an arrow per transition, labelled with its conditions (`player within 200 px ·
after 500 ms`, or `at once`).

- **Add a state:** click a behaviour in the palette above the canvas, or drag it onto the canvas.
  The state's id is the behaviour's (`chase`, `chase2`, …). The first state creates the brain and
  becomes its start.
- **Add a transition:** drag from a card's right handle to another card. Drag from **Entry** to a
  card to make it the start; from **Any** for a transition that fires from every state (it never
  re-enters the state it leaves).
- **Move a card:** drag it — its place saves with the config. **Delete** / **Backspace** removes the
  selected card (with its transitions) or arrow.
- **Order matters:** each step the brain checks the Any transitions first, then the current state's,
  each in list order; the first whose conditions **all** hold fires. Use **↑ / ↓** on a transition
  to change its place.

Click a card to edit the **state**: rename it (its transitions, the start and the anim inputs that
follow it are renamed too), change its **behaviour**, set its parameters (empty fields show the
default and use it), **Start here**, **＋ From any state**, **Delete state**. Deleting a state also
removes its transitions and the anim inputs that follow it. Delete the start state and the first
state left becomes the start; delete the last state and the character has no brain.

| Behaviour | What it does | Parameters (default) |
|---|---|---|
| `idle` | stands still | — |
| `wander` | walks a random heading, turning every so often and at walls | speed 80, turnEvery 1500 ms |
| `patrol` | walks a path back and forth (or round a closed one); without a path, between its spawn point and `dx`, `dy` from it | speed 100, dx 200, dy 0, path, pingPong (on) |
| `followPath` | runs a path once (open) or forever (closed), then stops | speed 100, path |
| `chase` | heads for the nearest body with the tag, within range | tag `player`, range 200, speed 160 |
| `flee` | runs from the nearest body with the tag, within range | tag `player`, range 200, speed 160 |
| `keepDistance` | closes in or backs off to hold a distance | tag `player`, distance 200, speed 120 |
| `hover` | bobs on a sine around where it entered the state | amplitude 12, period 1200 ms, axis `y` |
| `shootAt` | stands still and, every so often, spawns a shot at the nearest target in range | tag `player`, every 2000 ms, speed 300, range 600, component, layer |

`path` names a **path** node drawn in the Scene Editor. `shootAt` needs the **component** a shot is
and the **layer** (a spawn layer of the scene) it spawns into, or it never fires.

Click an arrow to edit the **transition**: its conditions (all must hold; none fires at once),
**＋ Condition…**, the ↑ / ↓ order and **Delete transition**.

| Condition | True when |
|---|---|
| `targetWithin` | the nearest body with the tag is within `px` |
| `targetBeyond` | it is further than `px` (or no body has the tag) |
| `touching` | the character touches a body with the tag |
| `hitSolid` | its last step ran into a solid body |
| `timer` | it has been in the state for `ms` |
| `variable` | a Flow variable compares (`==`, `!=`, `<`, `<=`, `>`, `>=`) to a value (`true`, `false`, a number or text) |
| `random` | a seeded roll succeeds (`chance` 0–1, rolled every `every` ms, 1000 by default) |

A value the game could not read (a negative distance, a chance above 1, a blank tag) is not stored:
the condition keeps the value it had, and the field shows it again. (The same goes for movement,
speed, size and parameter fields.)

### Anim inputs

What drives the **look's state machine inputs**, so its animations follow the character with no
Flow wiring. Each number or bool input of the look's state machine is listed with a source:

- numbers: `speed` (px/s), `vx`, `vy`, `facing` (1 right, -1 left — the last way it moved),
  `height` (a hop's height above the ground plane, px);
- true / false: `moving` (faster than 1 px/s), `grounded` (standing on something), `onWall` (its
  last sideways move was stopped), `airborne` (off the ground — for a hop, while it is up), and
  `state:<id>` for each brain state (true while in it).

`grounded`, `onWall`, `airborne` and `height` only change for a character that falls (gravity, a
side-view jump or a flap) or hops.

A look with no such inputs says so — add them in the component's state machine (Invisible
Component Editor). An input mapped here that the look no longer has is shown with **Remove**.

### Abilities

A character's buttons that hit other characters (`arcade.abilities`; the online room's own are in
Game Config → Online → Rules). **Add ability** needs a second character to aim at; it starts as a
stun on every other character within 100 px, on a free button. Each ability has:

- **Button** `ability1` / `ability2`: a played character uses it while the Flow input map's action
  of that name is held; on its brain, whenever a target is in reach; Flow's **Use Ability** uses it
  once.
- **Effect**: `stun` holds each target still for **Holds**; `catch` puts it out (hidden, touching
  nothing) for **Holds**, then back where it spawned; `hook` only raises `hit` on the nearest target
  (there is no line offline).
- **Reach** (px, centre to centre), **Holds** (ms, default 3000), **Cooldown** (ms, default 1000,
  at least 100), **Score** (sent to Flow as `points`; blank is 0).
- **Hits**: the characters it aims at. The last one cannot be unticked.

A target whose stun or catch ends cannot be hit again for a second. A held user cannot use its
abilities. The same code runs an online room's abilities, so a trace gives the same hits in both.

### Zone forces

The whole game's zones (Game Config → Zones), each with a **Push x** / **Push y** in px/s: a body
in the zone has it added to its velocity while it moves (a river's current, wind), and taken off
again. With no character ticked under **Only** it pushes every body, characters or not; ticked, only
those characters. 0 / 0 removes the force. An online game plays its rules' currents instead (the
validator warns).

### Issues

The validator's findings for the selected character are listed at the top of its panel, and the
cards and arrows they concern are outlined in orange. Errors (two characters with one id or one
look, a start or a transition naming no state, …) block **Save**; warnings (a played character
whose look has no body, a `chase` or `flee` tag no body carries, a `shootAt` without component or
layer, an anim input following a state the brain does not have) do not.

## The sandbox

Under the editor, a play field runs the selected character through **the game's own characters
stage** (the code the arcade loop runs, on `engine-mechanics`) at the config's steps per second, so
what you see is what the game does.
**Placeholder shapes only**: the character is an orange box or circle (its body, or a 48 × 48 box
when its look has none) labelled with its name and its brain state; the dummy **player** (tag
`player`) is a blue box — a plain body, as any non-character is in the game, so it walks through
walls; walls are grey; shots are small red circles. Project art is never loaded.

- **Click the field**, then the **arrow keys or WASD** move the dummy player — or the character
  itself when it has a controller. **Space** is the `jump` action: it jumps, hops or flaps a played
  character; **W / ↑** (the `up` action) jump a side-scroll character and flap a flapper too. With
  both a controller and a brain, **Driven by** picks the controller (you) or the brain (a bot).
- A character that falls or hops plays as in the game: it falls onto the walls and the field's
  floor, jumps by its height and time, and a hop is drawn lifted above a shadow.
- **Move** mode: drag the player, the character or a wall; press on empty space to give a pointer
  controller its pointer.
- **＋ Wall** adds a solid wall (grey). A run starts with walls that suit the character: two in
  the middle for a plain mover; for a falling one, a one-way platform (light top edge) a short jump
  off the floor and a solid ledge above it; for a hopper, the two middle walls and a green **low
  wall** (ground level) to hop over. **＋ Platform** (falling characters) adds a one-way platform,
  **＋ Low wall** (hoppers) a ground-level wall, and **↺ Walls** puts back the starting walls.
- **Draw path**: click to add points (it counts from two). The drawn path stands in for every path
  a state names (and for `sandbox`). **Clear path** removes it.
- **▶ Play / ❚❚ Pause**, **Step** (one fixed step while paused), **↺ Reset**.
- **Seed** — the same seed and the same keys give the same run (`wander` and `random` draw from it).
- **Variables** (shown when a transition has a `variable` condition) — stand-ins for the Flow
  variables the game would read: `flag = true, score = 3` (one per comma or line; `true`, `false`,
  a number, else text).
- The readout shows the **brain state** (also lit on the canvas), who drives it, its **speed**,
  for a falling or hopping character whether it is **Grounded** (and on a wall) and a hop's
  **height**, how many shots hit the player, the step count and every mapped **anim input**'s value as the game
  sets it (map `facing` to an input to see it).

Any change to the character (or the seed, the path, who drives, the variables, a new wall) restarts
the run.
Moving a card on the brain canvas does not. Nothing in the sandbox is saved — not the walls, the
path or the positions.

## The Whole view — every character, read-only

Everything above is the **Edit** view, which edits the config's characters. A character can also
live elsewhere — an online class, Salmons' built-in clips, a 3D look — and no one of those homes
names the others. The **Whole** view joins them so you can see each character in one place.

Open it with the **Edit | Whole** switch at the top of the page (or go straight to
`/characters?view=whole`; switching back drops `view` from the address). It shows on arcade
configs only. It is **read-only**: nothing here changes the config, and each card links (**↗**) to
the tool that makes its part. It reads the config as the page holds it, unsaved edits included;
the components, clips and screens it reads from the project — **↻** reads them again.

### Every character (left)

One row per character, joined from four homes:

- the config's characters (`arcade.characters`, what the Edit view edits);
- the online classes (`arcade.online.characters`, edited in Invisible Game Config → Online);
- Salmons' built-in clip table (only for a config that uses Salmons' art);
- the 3D looks (`arcade.world3d.looks`).

An online class joins a config character **by look** (the component the character is and the
class's body is drawn as); Salmons' table and a 3D look join **by id** (the class's, else the
character's). A character sheet no class plays yet is shown on its own character's row. Under each name are its roles: `brain` or `offline` (a config character with or
without a brain), `online`, `built-in`, `3D`. The amber number is **how many things are missing**
for that character.

### The cards

- **Overview** (titled with the character's name):
  - **Look** — the component, with **Component Editor ↗** when it is in the project;
  - **Homes** — which of the four it lives in (hover one for its field and how it was joined);
  - **View** — side, top-down, isometric, 3D or "not implied", with the facings it is drawn in
    and those mirrored; the ⓘ lists what it was read from. For a character with a sheet that is
    the view its sheet names (or the four diagonals when the sheet names none). With no sheet no
    field names a view: it is what the other fields imply (its clip block's facings, whether a
    screen is isometric, its controller kind);
  - **Source** — what draws it: frame clips (from its character sheet, its component's clip block
    or the game's own table), its component, code (Salmons' look) or a 3D model;
  - the list of **what is missing** (a look that is not a component of the project, a body with no
    `arcade.bodies` entry, no clip block, clips not made or with nothing to play, clips that play
    only online with no class drawn as it, a sheet its class names but the game does not play,
    with the reason, a 3D look with no model or no animation graph) — or "Nothing missing".
- **Clips** — the grid Flipbook's Characters mode shows (states down, facings across; ✓ ⇋ ≈ —),
  read-only, with "made of needed", the width it is drawn at and where the clips come from: _the
  character sheet of_ a character, _its component's block_ or _the game's own block_. For a
  character with a sheet the rows are the sheet's actions and the columns its view's facings. A
  sheet the game does not play is named in amber with the reason, and the grid shows the block
  the class plays meanwhile. A character with variants (the golden salmon) has a **base /
  variant** switch. **Edit the sheet ↗** (when the clips shown are a sheet's) jumps to the Edit view on its
  sheet's View card; **Flipbook ↗** opens Flipbook's Characters mode on this character, where the
  clips are made.
- **Directions** — the character in every facing at once, at the game's size, in its real art:
  the same preview as Flipbook's.
- **Online class** — **Speed**, **Places** (how many may play it), **Spawns** (how many, at random
  or in turn, or the room's), **Bots** (the brains that play it) and a table of the room's
  **abilities** for it (button, effect, reach, targets, holds, cooldown, once a press or while
  held). **Game Config ↗** opens Invisible Game Config to edit it; the numbers can also be edited
  on the sheet's [Online class](#online-class) card in the Edit view.
- **Character** — its `arcade.characters` entry in short: controller, movement, brain states,
  anim inputs, offline abilities. **Edit ↗** jumps to the Edit view with this character selected.
- **3D look** — model, clip libraries, what is attached to which socket, the animation graph and
  whether it has first-person arms. **Model Viewer ↗** opens Invisible Model Viewer on its model.

## Traps

- A component is one character. Duplicating a character, or picking a look another character has,
  is an error until you change it.
- Renaming a character does not rename it anywhere else (a Flow graph that names it keeps the old
  id); only its abilities, its zone forces and the online classes that name its sheet follow.
- **A sheet draws nothing until an online class names it.** A class and its sheet use the same
  component: changing the character's look, or the class's body in Game Config, to another
  component removes the link rather than re-pointing it.
- **A sheet with frame clips needs a draw width and at least one action**, or the config cannot
  be saved. **Start an empty sheet** and a prefix alone is not yet a sheet you can save.
- **Compare reads the saved config, not the published game**, and has nothing to compare after a
  Save. Compare first.
- **A clip name is matched exactly, lower-case.** A prefix or an action id with a capital finds
  no clip; the card warns.
- Game Config's two resets, and leaving the arcade family there, replace the characters and so
  remove their sheets; its confirmation says how many.
- A character with no look id cannot be stored, so **＋ Add** always asks for the look first.
- Keyboard controllers do nothing in the game until the Flow input map has `left` / `right` / `up` /
  `down` actions.

## Known limitations / TODOs

- **A sheet draws an online class from frame clips, and nothing else yet.** An offline
  (single-player) character still follows its look's state machine through **Anim inputs**; a rig
  or a 3D model cannot be a sheet's source (one already stored is kept, and the Animation source
  card says it is not edited here); a 3D view cannot be picked.
- **Actions: only what is listed above.** No playback rate, no markers, no "hold on the last
  frame" play mode, no brain-state or Flow trigger, and of the movement triggers only standing
  still and moving. An ability's wind-up and lock are not on the sheet.
- **Compare is against the saved config**, not a published snapshot of the game.
- **The draw box is numbers only**: no box is dragged over the art here. Set the box in Flipbook;
  the preview's **Box and feet** shows the result.
- **The sandbox does not draw the sheet.** It stays placeholder shapes; the Actions card's
  preview and the Whole view show the art.
- **A link with `&card=` unfolds and scrolls once**, when the page opens.
- **The sandbox's walls are boxes.** A level's tiles (tilemap nodes) are not drawn or used here;
  walls you add are solid, one-way or ground-level only by the button you used — drag them, but
  their kind cannot be changed (delete is not offered either: **↺ Walls** starts over).
- **Abilities have no hit-zone shape, offset or live frames** (§4.3 named them): an ability is a
  reach around its user's centre, as online. No animation is played: map one in Flow from `ability`.
- **The sandbox does not run abilities or zone forces.** Try them in the game.
- **Only characters can be targets.** A plain spawned body (not a character) is never hit; use a
  collision pair for it.
- **No touch gesture for an ability.** Map a key, or call Use Ability from a UI button's flow.
- **Fast bodies can pass through thin walls** — for a plain (non-falling, non-hopping) character:
  a step faster than the body and the wall together can carry it through a solid. A falling or
  hopping character moves in sub-steps and does not.
- **The sandbox is a stand-in.** One dummy player, the walls you draw, one path and the variables
  you type stand for the game's. A variable left out of the **Variables** field compares against
  nothing: `==` never holds and `!=` always does.
- **Invisible Flow's Preview does not run characters.** Try a character here, or publish to the test
  server and play it.
- **Renaming does not follow through.** A Flow graph that names a character by id keeps the old
  id (see Traps).
