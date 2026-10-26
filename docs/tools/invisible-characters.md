# Invisible Characters

Author the **characters of an arcade game**: the things on the play field that move by
themselves — a guard that patrols and chases, a fish that flees, a paddle the player drives. Each
one is a **look** (a component), a **body**, **movement** settings, a **controller** when the
player drives it and a **brain** when it acts on its own. A **sandbox** beside the editor runs the
character for real, with placeholder shapes, so you can try it before you save.

- **Where it runs:** Cloud (the launcher itself, Railway).
- **Access:** sign in at `app.invisiblewall.org`, then open `/characters` (granted to `developer`,
  `artist` and `pipelineTester` by default — the same roles as Invisible Game Config; `admin`
  always).
- **Scope:** per **active project**, and **arcade projects only**. A slot or match-3 project does
  not list the tool, and a direct link shows "Invisible Characters is not used by slot games" with
  a link home.

## Where the characters are stored

The characters live **inside the game config** (`arcade.characters` in the project's Game Config
document). So:

- they ship with the config — no extra export: Publish and the bake carry them, and each
  character's look (and every `shootAt` shot component) is shipped even when no scene places it;
- **Save** writes the whole game config through the same save as Invisible Game Config, with the
  same conflict check and the same **History** of versions (open it from Game Config);
- the two tools share **one edit lease**: while someone has Game Config (or this tool) open on the
  project, the other shows read-only with **Take over**. Two people cannot edit both at once;
- saving needs the Game Config grant too. A user given this tool without Game Config sees the page
  read-only, with a note saying so;
- the whole config must be valid to save. Errors outside the characters are listed in a note at the
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
field's edges (`clamp`, `wrap`, `pass`) and **Solid** (stops the characters that move into it). A
look with no body says _No body: it touches nothing_ with an **Add a body** button (a 100 × 100
box).

### Movement

How the velocity follows what the character wants, all optional:

| Field | Meaning | Empty |
|---|---|---|
| Accel px/s² | speeding up towards the wanted velocity | instant |
| Decel px/s² | slowing, stopping, reversing | same as accel |
| Max speed px/s | a cap on its speed | no cap |
| Turn rate °/s | how fast the heading may turn | instant |

### Controller

**Played with:** _none_ (not playable), _top-down_ (8-way), _side-scroll_ (left / right; the jump
comes later) or _pointer_ (follow the mouse or a finger on the **x**, **y** or **xy** axes).

- **Speed px/s** — a keyboard controller needs one (200 by default). A pointer controller may leave
  it empty: it then moves at the movement's max speed, or jumps straight to the pointer with none.
- The keyboard controllers read the Flow input map's actions **`left`, `right`, `up`, `down`** —
  map the keys to them in Invisible Flow. With none of them held, a pressed pointer or a touch
  steers instead.

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
default and use it), **Start here**, **＋ From any state**, **Delete state**.

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

A value the game could not read (a negative distance, a chance above 1, a blank tag) is simply not
taken: the field goes back to what it was.

### Anim inputs

What drives the **look's state machine inputs**, so its animations follow the character with no
Flow wiring. Each number or bool input of the look's state machine is listed with a source:

- numbers: `speed` (px/s), `vx`, `vy`, `facing` (1 right, -1 left — the last way it moved);
- true / false: `moving` (faster than 1 px/s), and `state:<id>` for each brain state (true while in
  it).

A look with no such inputs says so — add them in the component's state machine (Invisible
Component Editor). An input mapped here that the look no longer has is shown with **Remove**.

### Issues

The validator's findings for the selected character are listed at the top of its panel, and the
cards and arrows they concern are outlined in orange. Errors (two characters with one id or one
look, a start or a transition naming no state, …) block **Save**; warnings (a played character
whose look has no body, a `chase` tag no body carries, a `shootAt` without component or layer, an
anim input following a state the brain does not have) do not.

## The sandbox

Under the editor, a play field runs the selected character with the real arcade mechanics
(`engine-mechanics`) at the config's steps per second — the same order the game runs them in.
**Placeholder shapes only**: the character is an orange box or circle (its body, or a 48 × 48 box
when its look has none) labelled with its name and its brain state; the dummy **player** (tag
`player`) is a blue box; walls are grey; shots are small red circles. Project art is never loaded.

- **Click the field**, then the **arrow keys or WASD** move the dummy player — or the character
  itself when it has a controller. With both a controller and a brain, **Driven by** picks the
  controller (you) or the brain (a bot).
- **Move** mode: drag the player, the character or a wall; press on empty space to give a pointer
  controller its pointer.
- **＋ Wall** adds a solid wall; two stand in the middle to start with.
- **Draw path**: click to add points. The drawn path stands in for every path a state names (and
  for `sandbox`). **Clear path** removes it.
- **▶ Play / ❚❚ Pause**, **Step** (one fixed step while paused), **↺ Reset**.
- **Seed** — the same seed and the same keys give the same run (`wander` and `random` draw from it).
- The readout shows the **brain state** (also lit on the canvas), who drives it, its **speed**,
  **facing**, how many shots hit the player, the step count and every mapped **anim input**'s
  value as the game would set it.

Any change to the character (or the seed, the path, who drives) restarts the run. Nothing in the
sandbox is saved — not the walls, the path or the positions.

## Traps

- A component is one character. Duplicating a character, or picking a look another character has,
  is an error until you change it.
- Renaming a character does not rename it anywhere else (a Flow graph that names it keeps the old
  id).
- A character with no look id cannot be stored, so **＋ Add** always asks for the look first.
- Keyboard controllers do nothing in the game until the Flow input map has `left` / `right` / `up` /
  `down` actions.
