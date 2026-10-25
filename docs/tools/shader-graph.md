# Invisible Shader Graph

An online node editor for **shader effects**. You wire nodes (noise, masks, warps, colour) into one
effect, watch it live on a sample card or your own art, and save it. A saved effect plays anywhere
an Element FX plays: on a node, a screen, the reels, a symbol's state, or from the Flow.

## What it is

An **effect** is a small graph. Nodes have typed **ports**; wires carry values from one node's
output to another node's input; one **Output** node says what the element draws. When you save,
the graph is stored in the project. When the game is published, the graph is compiled into a
shader and plays as the Element FX kind **`custom:<id>`**, next to the 50 built-in effects.

- **It plays where an Element FX plays.** The Scene Editor, the Component Editor and Invisible
  Symbols list your effects under **Custom (Shader Graph)**, and the Flow's `elementEffect` can play
  them too. Triggers, intensity, keyed timelines, symbol states and turbo all work as they do for a
  built-in.
- **It checks itself as you build.** Every change re-checks and re-compiles the graph in the page.
  Errors show on the node that has them, and a meter shows how heavy the effect is for a phone.
- **The preview is the game's own code.** The preview plays the compiled effect through the same
  Element FX code the game runs, so what you see is what ships.
- **An effect is more than its graph.** It also has a phase and a length, **params** (the knobs an
  author sets where the effect is placed), up to four built-in **passes** drawn after the graph (a
  glow, an outline, a blur…), and **motion** curves that move the element itself.

- **Where it runs:** the launcher itself, at `/shaders`. It is a full-page tool inside the signed-in
  area, **never an iframe**. The top-bar switcher lists it as **Shaders**, in the Assets group after
  FX.
- **Access:** the `admin`, `developer`, `artist` and `pipelineTester` roles get it by default
  (`ROLE_TOOLS` in `apps/launcher-api/src/lib/roles.ts`). The `animator`, localization reviewer and
  music/SFX roles do not. Like any tool, an admin can grant or revoke it per role or per user in the
  admin panel. Effects belong to a project: with no project picked, the page asks you to pick one in
  the launcher first.

## The screen

- **Top bar.** The launcher's shared tool bar. With an effect open, its right side shows the **save
  pill** (or, while someone else is editing, the presence banner), **History**, and, if your role
  may publish to the studio library, **Publish to library** (see "The studio library").
- **Left: the library.** **Effects** lists the project's effects, with **+ New** and a **✕** to
  delete each one. **Nodes** below it is the node palette: the open effect's **Subgraphs** first,
  then the nodes grouped by family, with a search box.
- **Middle: the canvas.** A status bar on top, then the subgraph bar, then the graph. The status
  bar shows the effect's name, its kind (`custom:<id>`), then either **Compiles** or **N errors —
  not playable until fixed**, the cost meter **cost X/400 · reads Y/16** with its two bars, and the
  **Thumbnails** switch. The subgraph bar holds
  the **Pixel | Motion** switch, where the canvas is (**Effect › Subgraph…**) and the **Group** /
  **Open** / **Ungroup** buttons.
- **Right: preview and properties.** The live preview, then the selected node's properties (when a
  node is selected), then the effect's own settings (always).

## How to use it

### Open it and pick a project

Sign in to the launcher (`app.invisiblewall.org`) and open **Invisible Shader Graph**. Effects are
scoped to the project picked in the top bar, the same project selector the other tools use. Switch
projects to see another project's effects. The atlases the preview offers are that project's too.

### Make a new effect or open one

- **+ New ▾** opens a menu: **Empty effect**, or **Start from a built-in** (see below). **+ New
  effect** in the empty canvas makes an empty one. Either way it asks for a **Name** and creates the
  effect straight away. Its id is the name in lower case, every character but a letter or digit turned
  into `_`, up to 60 characters (`Pulse tint` → `pulse_tint`). If the project already has an effect
  with that id (or someone makes one while you type), a red notice asks you to pick another name.
  If the shared library has one, you are asked first: yours would take its place in this project.
- An empty effect starts with the **Output** alone. Unwired, the Output draws the element as it is,
  so it already compiles and changes nothing.
- Click a name in **Effects** to open it. Any unsaved change to the open effect is saved first.
- The page URL carries the open effect (`/shaders?graph=<id>`), so a reload or a shared link opens
  it again. A link to an effect the project no longer has opens nothing and says so.

### Start from a built-in

**+ New ▾ → Start from a built-in** lists the built-in Element FX rebuilt as graphs (their *twins*),
by family, as the Scene Editor's effect picker groups them: the 3D turns, the distortions and the
light effects (Freeze, Burn to ashes, Gold, Electrocute, the dissolves, Glow, Blur …), 30 in all.
Pick one, name your effect (it suggests "*Freeze* copy"), and you get that effect's whole graph to
change: its nodes and wires, its params (the same ones, with the same defaults, as the built-in's),
its passes and its motion. It plays as the built-in does until you change something.

- **Every twin is checked against its built-in.** CI renders each beside the built-in it rebuilds,
  at many moments and at every param's extremes, and fails when they look different.
- **Some twins' motion is close, not exact.** Where a built-in moves the element by the seconds
  played, a param or its looping (Bounce 3D's hops, Freeze's shiver, Poison's sway, Electrocute's
  jitter, Petrify, Gold), a motion curve cannot follow it, and the twin's curve is that motion at
  the defaults. **Melt's room** past the element's edge is set for its defaults: longer drips or a
  stronger play can be cut off. The menu item and the name dialog say so. The pixels are exact
  either way.
- **Not every built-in has a twin.** The motion-only effects (Shake, Pulse, Bounce, Pop in…) are
  motion curves alone, and the breaks (Crumble, Shatter…) are not pixel effects.
- The effect you make is your own: changing it never touches the built-in, and the built-in keeps
  playing as before wherever it is placed.

**The id never changes.** Renaming an effect (see "Effect settings") changes the label the pickers
show, not `custom:<id>`. Placed entries keep working after a rename. To get a different id, make a
new effect.

### Add nodes

Find a node in **Nodes** (the search box matches names and descriptions), then either **drag it
onto the canvas**, or **click it**. A clicked node lands just left of the selected node, or left of
the leftmost node when nothing is selected, ready to wire forwards. Hover a palette button to read
what the node does.

The families, in the palette's order (each family has a colour, shown on its heading and on each
node's top edge):

| Family         | What it holds                                                    | Some of its nodes                                                       |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Input**      | Where the pixel is, when it is, what the element looks like there | UV, UV (square), Element size, Time, Param, Number, Colour, Sample element, Outline, Relief height, Seed |
| **Time**       | Shapes for the play's progress                                   | Bell, Swell, Ease in-out, Overshoot, *In, hold, out*, Pulse, Flicker, Loop envelope, Bounce, Oscillate |
| **Math**       | Arithmetic on numbers or vectors alike                           | Add, Multiply, Mix, Clamp, Smooth step, Remap, Split, Combine, Pick     |
| **Procedural** | Noise and patterns                                               | Random, Noise, Fractal noise, Cells, Gradient, Radial, Stripes, Random number, Line noise, Arcs, Sparkles |
| **Mask**       | Where something is, and how far it has come                      | Away from a side, Front, Band, Glint, Edge distance, Inside, Away from side N |
| **UV**         | Move where the element is read from                              | Offset, Scale, Rotate, Twist, Bulge, Ripple, Wave, Polar, Flag, Perspective plane, Sphericon |
| **Colour**     | Colour and light                                                 | Split colour, Join colour, Brightness, Hue shift, Relief normal, Relief slope, Light, Metal, Over, Fade, Page curl |

There are 90 nodes in the palette. The **Output** is not in it: every effect has exactly one, and
it comes with the new effect.

**Time** (Input) gives the play's **Progress** (0…1), the **Seconds** since it started, the entry's
**Strength** (its intensity) and **Looping** (1 while it loops). Wire Strength in somewhere if the
entry's Intensity should matter.

**Seed** (Input) is a random number (0…97) drawn once for each element the effect plays on. Feed it
to Noise, Cells or Random number and two elements playing the effect at once look different, as the
built-ins do.

**Pick** (Math) turns a choice param into numbers: a choice reads as its option's place in the list
(0, 1, 2 …), and Pick gives the value you set for each. **Away from side N** takes a side as such a
number (0 bottom, 1 top, 2 edges, 3 centre, 4 left, 5 right), so a "starts from" choice param can
drive it.

**The Output's Blend** (its properties): **Normal** keeps each colour channel within its alpha, as
a premultiplied colour must. **Add** lets a colour brighter than its alpha add light over what is
behind the element: a glow or a halo past its edge (Electrocute and Poison use it).

### Read a node

- **Header:** the node's name in its family colour. A node with a choice or a param shows it next
  to the name (`bottom`, `Tint`).
- **Inputs** on the left, **outputs** on the right. Each port has a dot coloured by its type (the
  table below). An output also shows its type in words.
- **An unwired input shows the value it reads.** That is a number (`0.5`), a vector (`0.5, 0.5`),
  or a word for an input that reads something by default: `uv` (this pixel's place on the
  element, 0…1 across and down), `uvSquare` (the same in square units, so noise stays round on a
  tall element), `progress` (how far through the play), `seconds` (time since it started) or
  `sample` (the element's own colour at this pixel).
- **The thumbnail**, between the inputs and the outputs: what the node's first output (the first
  one wired onward) looks like over the element, at the preview's `t`, strength, element and
  backdrop. A number shows as grey, a vec2 as red–green, a colour as itself, a vec4 as the colour
  it is. It redraws a moment after an edit, only on the nodes the edit reaches, and live while the
  preview plays when the node reads the time.
  - **A hatched square:** the node does not compile on its own yet (something upstream of it is
    broken or unwired). An error elsewhere in the graph never blanks it.
  - **A dimmed picture:** an earlier picture, not redrawing now. Only the 40 thumbnails nearest the
    selection (or the middle of the view) stay live.
  - **No thumbnail:** the Output (the preview is its picture), the nodes that give one value
    everywhere (Number, Param, Colour, Seed, Time, Element size), and a subgraph's Input.
  - **Thumbnails** in the status bar turns them all off (remembered in this browser), for a slow
    machine or a very large graph.
- **The cost chip**, in the header: the node's work per pixel, and its reads of the element when it
  has any (`16 · 4r`). It is light when the node is a small part of the phone budget, amber from
  2.5% and red from 10%. Hover it for the numbers. A node that does not reach the Output has none;
  a call's chip is its whole subgraph's.
- **A red border** and red lines under the ports are the node's errors.
- **A dimmed node** has a warning: usually it "does not reach the Output and is left out". It is
  checked like the rest but costs nothing and draws nothing.
- Hover a node for its messages, or its description when it has none.

| Type      | Holds                                                    | Dot and wire colour |
| --------- | -------------------------------------------------------- | ------------------- |
| **float** | one number                                               | grey                |
| **vec2**  | two numbers: a UV or a point                             | green               |
| **vec3**  | three numbers: a colour (red, green, blue)               | blue                |
| **vec4**  | four numbers: a colour with its alpha, **premultiplied** | pink                |

A wire takes the colour of the output it leaves. Most Math inputs follow the node's type: Add,
Mix, Clamp and the rest work on floats or vectors alike, and take the width of their widest input.

**Premultiplied** means the colour is already multiplied by its alpha. That is what **Sample
element** gives and what the **Output** takes. To work on a colour, take it apart with **Split
colour** (colour + alpha), change the colour, and put it back with **Join colour**.

### Wire the graph

Drag from an **output dot** to an **input dot**. The canvas only takes a wire the compiler would
take:

- **A float spreads into a vector.** `0.5` into a vec3 input reads `0.5, 0.5, 0.5`.
- **A longer vector feeds a shorter input with its first parts.** A vec4 into a vec2 input gives
  its first two numbers.
- **A shorter vector never widens.** A vec2 will not drop on a vec3 input. Use **Combine** to build
  the vector you need, or **Join colour** to give a colour an alpha.
- **One wire per input.** A new wire into an input replaces the one that was there.
- **Never a node into itself.** A loop through several nodes can be drawn, but it is an error
  ("feeds itself through a loop of wires") until you break it.

Rewiring upstream can change a type downstream (an Add fed a vec3 becomes a vec3). If that makes a
wire wrong, the node it feeds says so and tells you what to use.

**On the canvas:** drag a node to move it. Click a node to select it; click empty canvas to clear
the selection. Click a wire to select it. **Delete** or **Backspace** removes what is selected.
Drag on empty canvas to box-select; **Shift**, **Ctrl** or **⌘**-click adds to the selection. Pan
with the **middle or right mouse button**, zoom with the **scroll wheel**, and use the buttons in
the corner to zoom or fit the graph.

### Subgraphs (reusable groups)

A **subgraph** is a group of nodes kept once in the effect and used as one node, a **call**, as
many times as you like. Editing the subgraph changes every call. It is how you name a piece of an
effect ("Rim light", "Wobble") and reuse it, like a function in the Flow.

- **Group.** Select nodes (box-select, or Shift / Ctrl-click) and press **Group N nodes** in the
  subgraph bar, or **Ctrl+G**. They become one call named "Group 1" (rename it in its properties).
  Each wire that crossed into the selection becomes one of its inputs, and each that crossed out
  one of its outputs; a value read twice inside enters once. The effect draws exactly as before.
  The Output is left out of a group (and a subgraph's own Input and Output too).
- **Open.** Double-click a call, press **Open** in the subgraph bar or the call's properties, or
  **✎** on its row in the palette. The canvas shows the subgraph's own nodes between its **Input**
  and **Output** nodes, and the bar reads **Effect › Group 1**. Click **Effect** (or an earlier
  name) to go back. Everything you do inside (add, wire, delete, undo) edits the subgraph.
- **Inputs and outputs.** Select the subgraph's **Input** or **Output** node to edit its ports:
  **+ Add input / output**, a name, a type (float, vec2, vec3, vec4), a default, and **✕** to remove
  one (with every wire to it). Every call gets the change. A call input left unwired reads the value
  set on the call, else the default, else 0.
- **Ungroup.** Select a call and press **Ungroup** (or **Ctrl+Shift+G**). Its nodes come back in its
  place, wired as they were. When it was the last call, the subgraph goes too. If you changed a
  port's type so it no longer matches what feeds it (a float input fed a colour), Ungroup would
  change the picture, so it refuses and names the port: set the port back to the type that feeds
  it, then ungroup.
- **Add another call.** Drag the subgraph's row in **Subgraphs** onto the canvas, or click it. The
  `N×` beside it counts its calls. A subgraph cannot call itself, directly or through another, so
  its row is greyed out where that would happen.
- **Delete.** **✕** on its row. If it is still called, it asks first, then removes the calls too.
- **Errors.** An error inside a subgraph shows on the call as "Name › …", so the effect's status bar
  still counts it. Open the subgraph to see it on the node that has it.
- **Limits.** A subgraph has at most 32 inputs and 32 outputs, an effect at most 64 subgraphs, and
  calls nest at most 4 deep. All the calls together may inline at most 4000 nodes, wires and ports;
  past that the calls are errors. Group refuses a selection that would need more than 32 ports.
- **The cost meter** counts every call in full: a subgraph called three times costs three times.

A subgraph belongs to its effect. To use the same group in another effect, rebuild it there.

### The motion graph (Pixel | Motion)

The **Pixel | Motion** switch at the left of the subgraph bar flips the canvas between two graphs.
**Pixel** is the graph described so far: what the element looks like at each pixel. **Motion** is a
second, smaller graph of plain numbers, worked out once per frame, that **moves the element and
sets its room**. Use it when a motion curve is not enough: motion that follows the seconds played
(a fast jitter), a param (a sway as wide as the Amount param), the entry's Strength, looping, a
random number per element, or room that grows as the effect plays.

- **Start one.** An effect with no motion graph shows "No motion graph yet…". Add any node from the
  palette and the **Motion Output** comes with it.
- **The palette** has the number nodes only: Time (Progress, Seconds, Strength, Looping), Param,
  Number, Seed, **Element shape** (Width, Height, Aspect), the Math nodes, the Time shapes (Bell,
  Swell, Hold, Pulse, Flicker, Loop envelope, Bounce, Oscillate…), Random number, Line noise and
  Band. They mean what they mean in the pixel graph, for one number. Wires join numbers only.
- **The Motion Output's inputs:** **X** (in element widths), **Y** (in heights), **Scale**, **Scale
  X**, **Scale Y**, **Rotation** (degrees), **Alpha** and **Padding** (room past the edge, as a share
  of the element's larger side).
  - A wired input **drives** that channel every frame and overrides its curve in the effect
    settings, whose row then reads **driven by the motion graph**.
  - Unwired, the input shows what plays instead: its curve, rest, or the effect's padding.
  - **The values are final.** Strength does not scale them unless you wire Time's Strength in.
    Oscillate alone swings ±1, so a Multiply after it (×15 on Rotation) makes a visible sway.
  - The channels keep their ranges: alpha 0…1, scale above 0.
- **Curves on the nodes.** Each motion node draws its value over one play (params at their
  defaults), with its lowest and highest value under it and a line and dot at the preview's `t`.
  Hatched means it cannot be worked out yet. Number, Param, Seed and Element shape draw none. The
  **Thumbnails** switch hides the curves too.
- **Errors** show on the node and count in the status bar's "N errors" whichever graph is shown; the
  Motion switch shows the count, or a dot while the graph drives something. In Motion the status
  bar shows **ops N/256**, the size of the compiled program.
- **Delete.** The Output cannot be deleted while other motion nodes are there. **Delete motion
  graph** in the bar removes it all after asking; Undo brings it back.
- **No subgraphs in Motion.** Group, Open and Ungroup are greyed out there.

The preview plays the motion as the game will. A game whose runtime predates this release plays the
effect without the motion graph's motion (its curves still play), so for a must-have motion on old
games, key it as a curve too.

### Edit a node (properties)

Click a node. Its properties open on the right, under the preview:

- the node's name and id, and a line on what it does;
- its errors, in red;
- **Settings**, for the nodes that have them: a choice (Away from a side's **From**, Wave's
  **Axis**), a param to read (**Param**: pick one of the effect's params, listed as `Label
  (kind)`), a number (**Number**) or a colour (**Colour**);
- **Inputs**: each input with its type. A wired input says **wired**. An unwired one has one box
  per part (x, y, z, w). An empty box shows its default greyed out, or the word it reads (`uv`,
  `progress`…). Clear every box of an input to go back to its default.

A value you type applies when you press **Enter** or leave the box.

A node this build does not know shows "This build has no "…" node. Delete it, or open the graph in
a newer build."

### Errors and the cost meter

- **Compiles** (green) means the effect will play. **N errors — not playable until fixed** (red)
  means it will not: the preview shows the element at rest, and the game will not ship it.
- **Where the errors are.** A node's errors are on the node and in its properties. Errors that
  belong to no node (a blank name, a bad param, pass or motion key) are listed in red at the top of
  the effect's settings.
- **The cost meter** compares the effect with what a phone affords. **cost** is the rough work per
  pixel, summed over the nodes that reach the Output (budget 400). **reads** is how many times each
  pixel reads the element (budget 16). Two thin bars show each as a share of its budget (amber from
  75%, red over). Over either budget the meter turns amber. That is a warning, not an error: the
  effect still compiles and ships, but it may run slowly on a phone. Each node's **chip** is its
  part, so the chips show where the cost is.
- **The heavy nodes.** Sphericon costs 200, Arcs 160, Cells 120, Fractal noise 90, Perspective
  plane, Page curl, Bounce and Sparkles 40 each, Noise 18, Relief normal 16. Outline reads the
  element 5 times, Relief normal and Relief slope 4, Page curl 3, Sample element and Relief height
  once each. An input left to read `sample` adds one read, however many inputs do it. Some twins are
  heavy because their built-ins are: Petrify's is over the cost budget.

### Effect settings

The effect's own settings sit at the bottom of the right pane, below the preview and the selected
node.

**Effect**

- **Name** — the label the pickers show. Changing it does not change the id.
- **Description** — the line the pickers show under the effect's name.
- **Plays as** — how one play behaves, as for a built-in kind:
  - **Loop** plays over and over. It is the natural pick for an *Always* trigger.
  - **Emphasis** plays and returns to rest.
  - **Enter** brings the element in: it starts hidden and ends at rest.
  - **Exit** takes the element out: it ends hidden and stays hidden until it is stopped or an
    entrance plays.

  When you add the effect in the Scene Editor, it picks a trigger to suit (a loop starts as
  *Always*, an entrance as *When shown*, anything else as *On cue*).
- **Length (ms)** — one play, 50 to 20,000 ms. An entry whose Duration is blank plays this length.
- **Padding** — room the graph may draw outside the element, as a share of its larger side (0 to
  2; blank is 0). Raise it for a glow or a ring that goes past the element's edge, or it is cut off
  at the box.

**Params — rows set where the effect is placed**

Params are the knobs of your effect. Each one shows up as a **Parameters** row on every entry that
uses the effect (in the Scene Editor, the Component Editor and Symbols), like a built-in's knobs.

- Add one with **+ number**, **+ color**, **+ bool** or **+ choice**. A new one comes with a
  starting label, id and default (a number "Amount" of 1 between 0 and 2, a colour, a switch that
  is on, or a choice of `a` / `b`).
- Each card has the **label**, the **id** (what a Param node reads and a placed entry stores), the
  kind, and **✕** to remove it. Below: a number's **default**, **min** and **max**; a colour's
  default; a switch's **on by default**; a choice's **options** (comma-separated) and its default.
- Read a param in the graph with a **Param** node. A number reads as a float, a colour as a vec3,
  a switch as 0 or 1, and a choice as its position in the list (0, 1, 2…).

**Passes — built-in effects drawn after the graph**

- **+ pass** adds a pass (a Glow); pick another kind from its dropdown: **Glow, Outline, Shine,
  Flash, Rainbow, Chromatic, Glitch, Blur** or **Pixelate**. Up to four, drawn in order. The button
  disappears at four.
- **strength**, next to the kind, multiplies the effect's intensity for that pass. Blank is 1. It
  is not the same as a Glow's own **Strength** knob, listed below it.
- Each of the pass's knobs is either **its own value** or a param (`= Tint`), tied to one of the
  effect's params of the same kind. Tie a glow's colour to a colour param, and the entry's colour
  row sets the glow too.
- **✕** removes the pass.

**Motion — the element's own movement over a play**

- Tick a channel to move it: **x** (in element widths), **y** (in element heights), **scale**,
  **scale x**, **scale y**, **rotation** (degrees) or **alpha**. The range it accepts shows next to
  it.
- A ticked channel starts with three keys at rest (t 0, 0.5 and 1), so nothing moves yet. Change a
  value, usually the middle key's.
- Each key has **t** (0…1 through the play), a **value**, and the **ease** into it: linear, smooth,
  in, out or hold. **+ key** adds one between the last two (up to 32). **✕** removes a key.
  Removing the last key turns the channel off.
- **Pivot** (x and y, 0…1, centre 0.5) is the point that scale and rotation turn about. It appears
  once a channel is on.
- Every channel but alpha grows with the entry's intensity.
- A channel the motion graph drives reads **driven by the motion graph**, its keys dimmed: the curve
  does nothing while the graph drives it. The same goes for **Padding**.

### The preview

The square stage at the top right plays the open effect, compiled, through the game's own Element
FX code. Nothing you set here is saved.

- **▶ / ❚❚** plays or pauses. It starts playing when the effect opens.
- **The t scrubber** shows how far through one play it is, 0 to 1. Dragging it pauses. Under it, the
  readout shows `t` and the time in ms against the effect's length.
- **Loop** starts again at the end. Untick it and the preview stops at the end; **▶** then starts
  from 0.
- **Intensity** (0 to 4, **↺** back to 1) is the entry's intensity: the Time node's Strength, the
  passes' strength and the motion all follow it.
- **Element** is what the effect plays on: the **Sample card** (a drawn card with a star and a
  "SAMPLE" strip), or **Atlas region**, which adds **Atlas** and **Region** dropdowns over the
  project's atlases. Symbol art is in the atlases. With no atlases, the option is greyed out.
- **Backdrop**: **Dark**, **Light** or **Checker** behind the element.

Moving a node, or any change that compiles to the same effect, does not restart the preview. While
the graph has errors the stage shows the element at rest and says "Doesn't compile — fix the errors
to preview."

### A first effect: a pulsing tint

This builds an effect that tints the element toward a colour and back, once per play.

1. **+ New**, name it `Pulse tint`. Set **Plays as** to *Emphasis* and keep **Length** at 1200.
2. Under **Params**, click **+ color**. Set its label to `Tint` and pick a colour.
3. Add **Split colour** (Colour). Its Colour input reads `sample`: the element's own colour.
4. Add **Param** (Input). In its Settings, pick **Tint (color)**.
5. Add **Colourize** (Colour). Wire Split colour's **Colour** into Colourize's **Colour**, and
   Param's **Value** into Colourize's **Tint**.
6. Add **Mix** (Math). Wire Split colour's **Colour** into **A**, and Colourize's **Out** into **B**.
7. Add **Bell** (Time). Its Progress reads `progress`. Wire its **Out** into Mix's **T**.
8. Add **Join colour** (Colour). Wire Mix's **Out** into its **Colour**, and Split colour's
   **Alpha** into its **Alpha**.
9. Wire Join colour's **Out** into the Output's **Colour**.

The status bar reads **Compiles** and the meter `cost 11/400 · reads 1/16`; the card in the
preview warms to your colour and back. To make the entry's Intensity matter, put a **Multiply**
between Bell and Mix's T, and wire Time's **Strength** into its other input.

### Save, undo and history

- **It autosaves** about a second after your last change. **Ctrl+S** (⌘S) saves at once; with
  nothing changed it saves nothing. There is no Save button.
- **The save pill** reads **Saving…**, **Unsaved changes**, **Saved** or **Save failed — retry**
  (click it to retry). **⚠ Wrong project — not saved** means the tab is on another project than
  the launcher's; **Reload** fixes it.
- **A graph with errors still saves.** You can stop halfway and come back. It just does not ship
  until it compiles.
- **Leaving.** Opening another effect saves first; if that save fails, it asks before dropping your
  changes. Leaving the page with unsaved changes asks too.
- **Undo / redo.** **Ctrl+Z** (⌘Z) undoes; **Ctrl+Shift+Z** or **Ctrl+Y** redoes. Every change is a
  step: adding, wiring, moving and deleting nodes, and every edit in the properties and settings.
  The last 100 steps are kept while the effect stays open in the tab; opening another effect or
  reloading starts fresh. In a text box, Ctrl+Z undoes your typing instead.
- **History** lists earlier saved versions of this effect, newest first. A version is kept at most
  every five minutes while you work, and the newest 20 are kept. Pick one and **Restore**. Restoring
  keeps the current version as an entry first, so a restore can be undone from the same list. It
  discards unsaved changes.

### Two people on one effect

Only one person edits an effect at a time. If someone else (or another tab of yours) has it open,
the top bar reads "*name* is editing this — read-only". The node library, the properties and the
settings are disabled, nothing on the canvas moves, wires or deletes, and the effect cannot be
deleted. You can still open or make another effect, and the preview still works. **Take over**
moves editing to you, and the other tab turns read-only.

If someone saved the effect after you opened it, the pill reads **⚠ Someone else saved this**.
**Reload theirs** drops your changes and loads their version. **Overwrite with mine** replaces their
version with yours (theirs stays in History).

### Shared effects

The list can include effects from the studio's **shared library**, tagged **shared**. They have no
✕. Open one and the status bar says "shared — saving keeps a copy in this project".

- Your first change autosaves a **copy** into the project. The copy has the same id, so in this
  project it takes the shared effect's place, and every entry naming it plays your copy.
- The shared original is never changed. Delete your copy to go back to it.
- History starts once the copy exists.

### The studio library

The **studio library** is a set of effects every project takes in. Publishing an effect there lets
any project place it as `custom:<id>` without copying it.

- **Who.** Admins, by default. An admin can grant **Publish shared shader effects** to another role
  or user in the admin panel. Without it the button is not shown, and the server refuses anyway.
- **Publish.** Open one of the project's own effects and press **Publish to library** in the top
  bar. It saves first, then copies the effect **as saved**. Only an effect that compiles can go;
  otherwise it says to fix the errors first. In the list the effect is then tagged **in library**.
- **Update.** On an effect already in the library the button reads **Update library copy**. It
  asks before replacing the library's version. If someone published an effect of that id since you
  opened the page, it says so and asks again.
- **Remove.** Open the library's effect (tagged **shared**) and press **Remove from library**.
  Projects with their own effect of that id keep it. Projects that only placed the library's play
  nothing for it from their next Publish, which names those entries.
- **Nothing is lost.** Each replace and each removal keeps the version it replaced, under
  `_shared/shader-backups/<id>/`. The page has no History for the library yet: an admin restores a
  version by copying it back to `_shared/shaders/<id>.json` in Invisible FTP Browser.
- **A project's own effect wins.** A project with an effect of the same id keeps playing its own.

Only the effects a game names are shipped with it (see "Getting an effect into a game"), so a large
library does not make games bigger.

### Delete an effect

Click **✕** next to an effect and confirm. If it was open, the canvas empties.

- Entries naming it keep their place and play nothing until an effect with that id exists again.
  If it was your copy of a shared effect, the shared one plays again instead.
- Its saved versions stay in History. A new effect with the same name has the same id, so its
  History reaches them.

### Getting an effect into a game

1. **Place it.** In the Scene Editor or the Component Editor, select an element and open its
   **Element FX** section. **+ Add effect…** lists your effects under **Custom (Shader Graph)**,
   after the built-ins. In Invisible Symbols, the **Element FX** block of a state cell lists them
   the same way. In the Flow, the `elementEffect` action's **kind** dropdown lists them as
   `custom:<id>`. The entry's **Parameters** rows are your effect's params; **▶** previews it.
2. **Publish.** Saving does not change a published game. The next **Publish** (or bake) compiles
   the project's effects, the studio library's included, and ships the ones the game names (in a
   scene, a component, a symbol or the Flow), which it registers before its first frame. An effect
   nothing names is not shipped.

- **An effect that does not compile is saved but not shipped.** Entries naming it play nothing. In
  the Scene Editor such a row reads `⚠ custom:<id>`, with a note that the project has no shader
  effect of that name that plays. After a Publish, Game Maker's publish note lists every such
  effect the game names.
- **The pickers read your effects when their page loads.** After saving a new effect, or renaming
  one, reload a Scene Editor, Symbols or Flow tab that is already open.

## Traps

- **The whole effect stops on one error.** A single error anywhere (a node, a param, a pass, a blank
  name) means nothing ships and the preview is at rest. Fix the red items until the status bar reads
  **Compiles**.
- **A new Param node is an error** ("Param needs one of the effect's params picked") until you pick
  a param in its Settings.
- **An unknown node or a graph without its one Output freezes the meter and the port colours.** The
  check cannot walk such a graph, so the meter reads 0 and the ports show their declared types. Any
  other error leaves them working.
- **The Output cannot be deleted.** Every effect has exactly one, and the palette has none to add.
- **A colour will not drop on the Output.** A colour is a vec3 and the Output takes a premultiplied
  vec4. Put it through **Join colour** with an alpha (Split colour's Alpha keeps the element's
  shape).
- **Changing a param's id.** Param nodes and tied pass knobs reading the old id turn into errors
  (pick the param again), and a placed entry's value for it no longer applies. Change the label
  instead, or set the id before you place the effect.
- **Effects cut off at the edge.** A glow, a ring or a warp that reaches past the element is clipped
  at its box. Raise **Padding**.

## Known limitations / TODOs

- **The preview plays the params' defaults.** There is no per-preview value yet: to see another
  value, change the default (and remember that the default is what a placed entry starts with).
- **The preview has no rig still yet** (the plan's fourth source, beside the sample card and the
  atlases).
- **The preview uses WebGL2 where the browser has it** (CI checks every shader on WebGL1 too). It
  does not follow a change of screen pixel ratio (reload after moving the window to another
  screen), and it clips a graph padded to the 2× maximum at its edge.
- **A twin's limits are the doc's.** A motion curve cannot read a param or the seconds played (the
  motion gaps above), and an effect's padding is one number: the Wave and Bounce 3D twins take the
  room their largest setting needs at strength 1, Melt the room its defaults need, and either can
  clip past the edge beyond that.
- **Not yet:** a Break output and an admin-only Custom GLSL node. They are later steps of the
  plan.
- **Subgraphs belong to one effect.** There is no way yet to share a subgraph between effects.
- **Thumbnails take a moment on a large graph.** Each new picture compiles a small shader the first
  time; opening a 100-node graph draws its pictures over a few seconds. Turn **Thumbnails** off if
  it slows a machine down. Nodes after a subgraph's Input show the inputs' defaults.
- **The studio library's history is not in the page.** A replaced or removed library version is
  kept, but restoring it takes an admin and Invisible FTP Browser.
- **Nodes the plan lists that v1 lacks:** rim and a pixel input.

## For developers

- **Design and build plan:**
  [`../design/invisible-shader-graph.md`](../design/invisible-shader-graph.md). **Current state:**
  [`../status/shader-graph.md`](../status/shader-graph.md).
- **The tool page:** `apps/launcher-api/src/routes/(app)/shaders/`. `shaderEditor.ts` is the pure
  editing model (every gesture is doc → doc; the canvas asks the compiler's own `canFeed` before it
  takes a wire). `ShaderPreview.svelte` + `shaderPreview.client.ts` pose the compiled effect through
  `pixi-svelte/elementFx`. The canvas is the shared `$lib/graph/GraphCanvas.svelte`.
- **The package:** `packages/engine-shadergraph` — the doc (`types.ts`, `doc.ts`), the node library
  (`nodes.ts`, with each node's cost and reads), the validator and compiler (`compile.ts`:
  `analyzeShaderGraph`, `compileShaderEffect`, `COST_BUDGET`, `SAMPLE_BUDGET`), and subgraphs
  (`subgraph.ts`: `flattenShaderGraph` inlines every call before the compiler sees the graph, so
  nothing past the compiler knows they exist).
- **Storage and ship:** `src/lib/server/shaderStorage.ts` (`<client>/<project>/shaders/<id>.json`,
  shared at `_shared/shaders/`, its history at `_shared/shader-backups/`),
  `/api/shaders/{list,doc,effects,save,delete,backups,publish,unpublish}` (publish and unpublish
  need the `shaderPublish` capability, `shaderScope.ts`), and `shaderExport.ts` (Publish and the
  bake, into `deploy/editor-shaders/`; a bundle embeds only the effects it names,
  `namedShaderEffects`).
- **The motion graph:** `motionGraph` in the doc; `analyzeShaderMotion` / `compileShaderMotion`
  (`compile.ts`) compile it to `motion.program`, a capped op list the runtime runs each frame
  through `packages/constants-shared/motionLibrary.ts` (`runMotionProgram`, the CPU twin of
  `glslLibrary.ts`). `pnpm --filter fx-spike shader-motion` holds each motion node's JS to its GLSL.
- **The twins:** `packages/engine-shadergraph/src/twins.ts` (`BUILTIN_TWINS`) and `src/twins/`;
  `pnpm --filter fx-spike shader-twins` holds each to its built-in (in `check:all`).
- **Gates:** `pnpm --filter launcher-api check:shader-editor` and `check:shader-pipeline`.
