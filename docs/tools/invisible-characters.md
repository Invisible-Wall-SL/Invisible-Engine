# Invisible Characters

Author the **characters of an arcade game**: the things on the play field that move by
themselves — a guard that patrols and chases, a fish that flees, a paddle the player drives. Each
one is a **look** (a component), a **body**, **movement** settings, a **controller** when the
player drives it and a **brain** when it acts on its own. A **sandbox** below the editor runs the
character for real, with placeholder shapes, so you can try it before you save.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/characters` (granted to `developer`,
  `artist` and `pipelineTester` by default — the same roles as Invisible Game Config; `admin`
  always).
- **Scope:** per **active project**, and **arcade projects only**. A slot or match-3 project does
  not list the tool, and a direct link shows "Invisible Characters is not used by slot games" (or
  "match-3 games") with a link back to the launcher.

## Where the characters are stored

The characters live **inside the game config** (`arcade.characters` in the project's Game Config
document; their abilities in `arcade.abilities`, the zone forces in `arcade.forces`). So:

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

### Character

- **Id** — the name the brain, Flow and the runtime use. Type a new one and press **Rename**; a
  blank or taken id is refused with a message.
- **Name** — an optional display name (blank shows the id).
- **Look (component)** — the component a spawned instance of which _is_ this character. Every
  component of the project (and the shared and built-in ones) is offered.
- **Duplicate** — copies the character, right below it, as `<id>Copy`. The copy keeps the same
  look, which is an error until you pick another one.
- **Delete** — asks first. The brain, controller, movement and anim inputs go with it; its
  component and its body stay.

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

## Traps

- A component is one character. Duplicating a character, or picking a look another character has,
  is an error until you change it.
- Renaming a character does not rename it anywhere else (a Flow graph that names it keeps the old
  id); only its abilities and zone forces follow.
- A character with no look id cannot be stored, so **＋ Add** always asks for the look first.
- Keyboard controllers do nothing in the game until the Flow input map has `left` / `right` / `up` /
  `down` actions.

## Known limitations / TODOs

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
